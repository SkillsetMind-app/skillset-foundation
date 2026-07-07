import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { planByStripePriceId } from "@/data/plans";
import { defaultSkillsetCurrency } from "@/lib/payments/currencies";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  canonicalPlatformFeeBpsForPlan,
  createReleasedRefundTransferReversal,
  ledgerRefundStatus,
  payoutReleaseDelayDays,
  refundReversalClaimKey,
  resolveInvoicePaymentIntentId,
  shouldApplyOrderStatusTransition,
  shouldReleaseCheckoutLock,
  shouldReverseReleasedPayout,
  stripeProcessingFeeMinor,
  type TransferReversalStripeClient,
} from "@/lib/payments/rules";
import { getStripeClient, isStripeConfigured } from "@/lib/payments/server/stripe";
import { courseSubscriptionInterval } from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/stripe — the money core. Faithful port of the stripeWebhook
// Firebase HTTPS function (functions/src/index.ts). Verifies the Stripe
// signature, dedupes via two-phase idempotency on processed_stripe_events
// (processing -> done), and fulfils each handled event with the service-role
// client. Idempotency inside each handler comes from writing the payout_ledger
// row LAST and checking it FIRST (the "re-arm guard"), plus existence-guarded
// enrollment writes — so a retried/redelivered event never double-fulfils.
//
// The release engine (/api/cron/release-payouts) moves cleared payouts, and
// charge.refunded claws back an already-released transfer proportionally
// (reverseReleasedPayoutIfRefunded, below). The only remaining simplification is
// the payout-delay platformConfig read — we use the default 30-day window.

const HANDLED_STRIPE_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
]);

type Admin = ReturnType<typeof getSupabaseAdminClient>;

function nowIso(): string {
  return new Date().toISOString();
}

function getPayoutReleaseAt(delayDays: number = payoutReleaseDelayDays): string {
  return new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString();
}

function secondsToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

// Resolve the subscription id from an Invoice across API versions (Basil moved
// it under invoice.parent.subscription_details.subscription).
function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (typeof fromParent === "string" && fromParent) return fromParent;
  if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string") {
    return fromParent.id;
  }
  const legacyField = (invoice as { subscription?: string | { id: string } | null })
    .subscription;
  if (typeof legacyField === "string" && legacyField) return legacyField;
  if (legacyField && typeof legacyField === "object" && typeof legacyField.id === "string") {
    return legacyField.id;
  }
  return null;
}

// --- two-phase idempotency on processed_stripe_events -----------------------
async function claimStripeEvent(
  admin: Admin,
  eventId: string,
): Promise<"process" | "duplicate"> {
  // ON CONFLICT DO NOTHING via ignoreDuplicates: rows are returned ONLY when we
  // actually inserted (won the claim). A conflict returns [] -> read the status.
  const { data: claimed, error } = await admin
    .from("processed_stripe_events")
    .upsert(
      { stripe_event_id: eventId, status: "processing", claimed_at: nowIso() },
      { onConflict: "stripe_event_id", ignoreDuplicates: true },
    )
    .select("stripe_event_id");
  if (error) throw new Error(error.message);
  if (claimed && claimed.length > 0) return "process";

  const { data: existing } = await admin
    .from("processed_stripe_events")
    .select("status")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  // Short-circuit ONLY on "done"; a stuck "processing" means a prior attempt
  // died mid-flight, so reprocess (handlers are idempotent).
  return existing?.status === "done" ? "duplicate" : "process";
}

async function markStripeEventDone(admin: Admin, eventId: string): Promise<void> {
  const { error } = await admin
    .from("processed_stripe_events")
    .update({ status: "done", processed_at: nowIso() })
    .eq("stripe_event_id", eventId);
  if (error) throw new Error(error.message);
}

// --- one-time checkout fulfilment -------------------------------------------
async function handleCheckoutCompleted(
  admin: Admin,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const orderId = session.metadata?.orderId;
  const courseId = session.metadata?.courseId;
  const userId = session.metadata?.userId;
  if (!orderId || !courseId || !userId) {
    throw new Error("Missing required Checkout metadata.");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  // Re-arm guard: the ledger is created exactly once per order (LAST, below). If
  // it already exists this order was fully fulfilled — a redelivery / async
  // event / replay must NOT re-run fulfilment (would re-schedule a payout for
  // possibly-refunded money). Skip idempotently.
  const { data: existingLedger } = await admin
    .from("payout_ledger")
    .select("id")
    .eq("id", orderId)
    .maybeSingle();
  if (existingLedger) return;

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error(`Order ${orderId} not found.`);

  const { data: course } = await admin
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) throw new Error(`Course ${courseId} not found.`);

  // Best-effort receipt url off the PaymentIntent's latest charge. Never blocks.
  let receiptUrl: string | null = null;
  const receiptIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (receiptIntentId) {
    try {
      const intent = await getStripeClient().paymentIntents.retrieve(receiptIntentId, {
        expand: ["latest_charge"],
      });
      const latestCharge = intent.latest_charge;
      if (latestCharge && typeof latestCharge !== "string") {
        receiptUrl = latestCharge.receipt_url ?? null;
      }
    } catch {
      // ponytail: receipt lookup is best-effort; never blocks fulfilment.
    }
  }

  const grossAmountMinor = Number(order.amount_minor || 0);
  // ?? not || so an explicit 0 (Plus plan, zero commission) survives.
  const platformFeeBps = Number(order.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS);
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor = stripeProcessingFeeMinor(grossAmountMinor, order.currency);
  const netAmountMinor = Math.max(0, grossAmountMinor - skillsetFeeMinor - stripeFeeMinor);
  const ts = nowIso();

  // payment (id = PaymentIntent), merge-safe.
  await admin.from("payments").upsert(
    {
      id: paymentIntentId,
      order_id: orderId,
      user_id: userId,
      course_id: courseId,
      amount_minor: order.amount_minor,
      currency: order.currency,
      provider: "stripe",
      provider_payment_id: paymentIntentId,
      status: "succeeded",
      ...(receiptUrl ? { receipt_url: receiptUrl } : {}),
      updated_at: ts,
    },
    { onConflict: "id" },
  );

  await admin
    .from("orders")
    .update({
      status: "paid",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      ...(receiptUrl ? { receipt_url: receiptUrl } : {}),
      paid_at: ts,
      updated_at: ts,
    })
    .eq("id", orderId);

  // Grant access if not already enrolled (never downgrade).
  await admin.from("enrollments").upsert(
    {
      id: `${userId}__${courseId}`,
      user_id: userId,
      course_id: courseId,
      course_slug: courseId,
      course_title: course.title,
      course_category: course.category,
      course_image: course.cover_image_url || "/brand/logo-mark.png",
      status: "active",
      source: "payment",
      progress_percent: 0,
      created_at: ts,
      updated_at: ts,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  // Ledger LAST (the re-arm gate). Legacy amount_minor/platform_fee_minor are
  // mirrored (gross / skillset fee) so the table's CHECK holds.
  await admin.from("payout_ledger").insert({
    id: orderId,
    teacher_id: course.owner_id,
    teacher_stripe_connected_account_id:
      order.teacher_stripe_connected_account_id ||
      course.stripe_connected_account_id ||
      null,
    course_id: courseId,
    order_id: orderId,
    payment_id: paymentIntentId,
    payment_id_is_payment_intent: true,
    kind: "course_one_time",
    amount_minor: grossAmountMinor,
    platform_fee_minor: skillsetFeeMinor,
    gross_amount_minor: grossAmountMinor,
    skillset_fee_minor: skillsetFeeMinor,
    stripe_fee_minor: stripeFeeMinor,
    net_amount_minor: netAmountMinor,
    currency: order.currency,
    platform_fee_bps: platformFeeBps,
    status: "in_release",
    release_at: getPayoutReleaseAt(),
    created_at: ts,
    updated_at: ts,
  });

  // Release the in-flight checkout lock now that the purchase settled — only if
  // it still belongs to THIS order (a sibling attempt's lock must survive). [B3]
  const lockKey = `${userId}__${courseId}`;
  const { data: lock } = await admin
    .from("checkout_locks")
    .select("order_id")
    .eq("lock_key", lockKey)
    .maybeSingle();
  if (lock && shouldReleaseCheckoutLock(lock.order_id, orderId)) {
    await admin.from("checkout_locks").delete().eq("lock_key", lockKey);
  }
}

// --- course-subscription invoice fulfilment ---------------------------------
async function handleCourseSubscriptionInvoicePaid(
  admin: Admin,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const meta = subscription.metadata ?? {};
  if (meta.purpose !== "course_subscription") return;

  const courseId = typeof meta.courseId === "string" ? meta.courseId : null;
  const userId = typeof meta.userId === "string" ? meta.userId : null;
  const teacherId = typeof meta.teacherId === "string" ? meta.teacherId : null;
  if (!courseId || !userId || !teacherId) {
    throw new Error("course_subscription invoice is missing required metadata.");
  }

  const { data: course } = await admin
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) throw new Error(`Course ${courseId} not found for subscription invoice.`);
  const { data: owner } = await admin
    .from("users")
    .select("current_plan_id,stripe_connected_account_id")
    .eq("uid", teacherId)
    .maybeSingle();

  const platformFeeBps = owner
    ? canonicalPlatformFeeBpsForPlan(owner.current_plan_id)
    : Number(meta.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS) || DEFAULT_PLATFORM_FEE_BPS;
  const connectedAccountId =
    (typeof meta.connectedAccountId === "string" && meta.connectedAccountId) ||
    course.stripe_connected_account_id ||
    owner?.stripe_connected_account_id ||
    null;

  const grossAmountMinor = Number(invoice.amount_paid || 0);
  const currencyUpper = String(invoice.currency || defaultSkillsetCurrency).toUpperCase();
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor =
    grossAmountMinor > 0 ? stripeProcessingFeeMinor(grossAmountMinor, currencyUpper) : 0;
  const netAmountMinor = Math.max(0, grossAmountMinor - skillsetFeeMinor - stripeFeeMinor);

  // Resolve the REAL PaymentIntent so the ledger join key matches the refund
  // clawback (charge.payment_intent). Throw when a payout-bearing ledger would
  // otherwise store a degraded (invoice-id) key — forces Stripe redelivery.
  let resolvedPaymentIntentId = resolveInvoicePaymentIntentId(invoice);
  if (!resolvedPaymentIntentId && invoice.id) {
    const ledgerWillBeWritten = grossAmountMinor > 0 && Boolean(connectedAccountId);
    try {
      const expanded = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
      resolvedPaymentIntentId = resolveInvoicePaymentIntentId(expanded);
    } catch (error) {
      if (ledgerWillBeWritten) throw error;
      // ponytail: no ledger will be written (gross 0 / no account) -> degraded
      // key strands no clawback; proceed.
    }
  }
  const paymentId = resolvedPaymentIntentId ?? invoice.id ?? subscriptionId;

  const item = subscription.items.data[0];
  const periodEndIso = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as unknown as { current_period_end?: number }).current_period_end,
  );
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;
  const ts = nowIso();

  // Hold this invoice's net for the teacher — ledger keyed by invoice id (one
  // per invoice, idempotent against retries). Skip if it exists, gross 0, or no
  // connected account.
  if (invoice.id && grossAmountMinor > 0 && connectedAccountId) {
    const { data: existingLedger } = await admin
      .from("payout_ledger")
      .select("id")
      .eq("id", invoice.id)
      .maybeSingle();
    if (!existingLedger) {
      await admin.from("payout_ledger").insert({
        id: invoice.id,
        teacher_id: teacherId,
        teacher_stripe_connected_account_id: connectedAccountId,
        course_id: courseId,
        order_id: invoice.id,
        invoice_id: invoice.id,
        subscription_id: subscriptionId,
        payment_id: paymentId,
        payment_id_is_payment_intent: Boolean(resolvedPaymentIntentId),
        kind: "course_subscription",
        amount_minor: grossAmountMinor,
        platform_fee_minor: skillsetFeeMinor,
        gross_amount_minor: grossAmountMinor,
        skillset_fee_minor: skillsetFeeMinor,
        stripe_fee_minor: stripeFeeMinor,
        net_amount_minor: netAmountMinor,
        currency: currencyUpper,
        platform_fee_bps: platformFeeBps,
        status: "in_release",
        release_at: getPayoutReleaseAt(),
        created_at: ts,
        updated_at: ts,
      });
    }
  }

  // Grant on first paid invoice; re-activate on renewal after a lapse; never
  // downgrade an already active/completed enrollment.
  const enrollmentId = `${userId}__${courseId}`;
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) {
    await admin.from("enrollments").insert({
      id: enrollmentId,
      user_id: userId,
      course_id: courseId,
      course_slug: courseId,
      course_title: course.title,
      course_category: course.category,
      course_image: course.cover_image_url || "/brand/logo-mark.png",
      status: "active",
      source: "subscription",
      subscription_id: subscriptionId,
      progress_percent: 0,
      created_at: ts,
      updated_at: ts,
    });
  } else if (!["active", "completed"].includes(String(enrollment.status))) {
    await admin
      .from("enrollments")
      .update({
        status: "active",
        source: "subscription",
        subscription_id: subscriptionId,
        updated_at: ts,
      })
      .eq("id", enrollmentId);
  }

  // Mirror the subscription for the learner's cancel UI + lifecycle handler.
  await admin.from("course_subscriptions").upsert(
    {
      id: subscriptionId,
      user_id: userId,
      course_id: courseId,
      course_slug: courseId,
      teacher_id: teacherId,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: stripeCustomerId,
      status: subscription.status,
      interval: courseSubscriptionInterval(course.payment_type),
      current_period_end: periodEndIso,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      latest_invoice_id: invoice.id,
      updated_at: ts,
    },
    { onConflict: "id" },
  );
}

// --- course-subscription lifecycle ------------------------------------------
async function handleCourseSubscriptionLifecycle(
  admin: Admin,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const meta = subscription.metadata ?? {};
  if (meta.purpose !== "course_subscription") return false;

  const courseId = typeof meta.courseId === "string" ? meta.courseId : null;
  const userId = typeof meta.userId === "string" ? meta.userId : null;
  const teacherId = typeof meta.teacherId === "string" ? meta.teacherId : null;
  if (!courseId || !userId) return true; // ours; swallow so plan handler isn't called

  const status = subscription.status;
  const entitled = status === "active" || status === "trialing";
  const revoke =
    status === "canceled" ||
    status === "unpaid" ||
    status === "incomplete_expired" ||
    status === "paused";

  const item = subscription.items.data[0];
  const interval = item?.price?.recurring?.interval ?? null;
  const periodEndIso = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as unknown as { current_period_end?: number }).current_period_end,
  );
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;
  const ts = nowIso();

  await admin.from("course_subscriptions").upsert(
    {
      id: subscription.id,
      user_id: userId,
      course_id: courseId,
      course_slug: courseId,
      ...(teacherId ? { teacher_id: teacherId } : {}),
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeCustomerId,
      status,
      interval,
      current_period_end: periodEndIso,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      past_due: status === "past_due" || status === "unpaid",
      updated_at: ts,
    },
    { onConflict: "id" },
  );

  const enrollmentId = `${userId}__${courseId}`;
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) return true; // invoice.paid creates it; lifecycle never creates

  const enrollmentStatus = String(enrollment.status ?? "");
  if (revoke && enrollmentStatus === "active") {
    await admin
      .from("enrollments")
      .update({ status: "revoked", updated_at: ts })
      .eq("id", enrollmentId);
  } else if (entitled && enrollmentStatus === "revoked") {
    await admin
      .from("enrollments")
      .update({
        status: "active",
        source: "subscription",
        subscription_id: subscription.id,
        updated_at: ts,
      })
      .eq("id", enrollmentId);
  }
  return true;
}

// --- released-transfer refund clawback --------------------------------------
// Claw back an already-released payout when its sale is refunded. Only a
// released transfer (money that actually left the platform) can be reversed; an
// in_release/releasing payout is simply reduced by the release engine. Keyed by
// (chargeId, cumulative amount_refunded) in refund_reversal_claims so a Stripe
// redelivery of the same refund never double-reverses.
//
// ponytail: refund_reversal_claims is a plain idempotency guard, not a
// transactional reservation. Two DISTINCT partial refunds on one charge handled
// concurrently could each plan against the same reversed balance — but
// releasedRefundReversalAmountMinor caps each at the transferred amount and
// Stripe caps cumulative reversals at the transfer total, so the teacher is
// never over-clawed. Upgrade to a SECURITY DEFINER RPC that claims the jsonb map
// transactionally only if concurrent partial refunds ever become common.
async function reverseReleasedPayoutIfRefunded(
  admin: Admin,
  ledgerId: string,
  charge: Stripe.Charge,
): Promise<void> {
  const { data: ledger } = await admin
    .from("payout_ledger")
    .select(
      "status,transfer_id,transfer_amount_minor,gross_amount_minor,net_amount_minor,transfer_reversed_amount_minor,refund_reversal_claims,order_id,course_id,teacher_id",
    )
    .eq("id", ledgerId)
    .maybeSingle();
  if (!ledger) return;

  const releasedTransferAmountMinor = Number(ledger.transfer_amount_minor || 0);
  if (
    !shouldReverseReleasedPayout({
      transferId: ledger.transfer_id,
      releasedTransferAmountMinor,
    })
  ) {
    return;
  }

  const claims =
    (ledger.refund_reversal_claims as Record<string, { state?: string }> | null) ?? {};
  const claimKey = refundReversalClaimKey(charge.id, charge.amount_refunded);
  if (claims[claimKey]?.state === "done") return;

  const alreadyReversed = Number(ledger.transfer_reversed_amount_minor || 0);
  const { reversalId, reversalAmountMinor } =
    await createReleasedRefundTransferReversal({
      stripe: getStripeClient() as unknown as TransferReversalStripeClient,
      ledgerId,
      transferId: ledger.transfer_id,
      grossAmountMinor: Number(ledger.gross_amount_minor || 0),
      refundedAmountMinor: Number(charge.amount_refunded || 0),
      releasedTransferAmountMinor,
      netAmountMinor: Number(ledger.net_amount_minor || 0),
      alreadyReversedAmountMinor: alreadyReversed,
      idempotencyKey: `reversal_${ledgerId}_${charge.amount_refunded}`,
      metadata: {
        orderId: String(ledger.order_id ?? ""),
        courseId: String(ledger.course_id ?? ""),
        teacherId: String(ledger.teacher_id ?? ""),
        chargeId: charge.id,
      },
    });

  const ts = nowIso();
  await admin
    .from("payout_ledger")
    .update({
      transfer_reversed_amount_minor: alreadyReversed + reversalAmountMinor,
      ...(reversalId
        ? { latest_transfer_reversal_id: reversalId, latest_transfer_reversal_at: ts }
        : {}),
      refund_reversal_claims: {
        ...claims,
        [claimKey]: { state: "done", plannedAmountMinor: reversalAmountMinor },
      },
      updated_at: ts,
    })
    .eq("id", ledgerId);
}

// --- charge.refunded (claws back an already-released transfer) --------------
async function handleChargeRefunded(admin: Admin, charge: Stripe.Charge): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const { data: payment } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentIntentId)
    .maybeSingle();

  const isFullRefund = charge.refunded === true;
  const refundedStatus = isFullRefund ? "refunded" : "partially_refunded";
  const ts = nowIso();

  if (!payment) {
    // Subscription invoice charge refunded from the Dashboard: no payments doc.
    // Find the subscription payout ledger (paymentId == PI, kind subscription)
    // and mark it refunded. (Transfer clawback is deferred to 2f.)
    const { data: ledgers } = await admin
      .from("payout_ledger")
      .select("id,status,kind")
      .eq("payment_id", paymentIntentId)
      .limit(5);
    const ledger = (ledgers ?? []).find((l) => l.kind === "course_subscription");
    if (!ledger) return;
    await admin
      .from("payout_ledger")
      .update({
        status: ledgerRefundStatus(isFullRefund, ledger.status),
        refunded_amount_minor: charge.amount_refunded,
        refunded_at: ts,
        updated_at: ts,
      })
      .eq("id", ledger.id);
    await reverseReleasedPayoutIfRefunded(admin, ledger.id, charge);
    return;
  }

  const orderId = String(payment.order_id || "");
  if (!orderId) throw new Error(`Payment ${paymentIntentId} is missing orderId.`);

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error(`Order ${orderId} not found for refunded payment.`);

  const { data: ledger } = await admin
    .from("payout_ledger")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  const nextLedgerStatus = ledgerRefundStatus(isFullRefund, ledger?.status);

  await admin
    .from("payments")
    .update({
      status: refundedStatus,
      refunded_amount_minor: charge.amount_refunded,
      refunded_at: ts,
      updated_at: ts,
    })
    .eq("id", paymentIntentId);

  await admin
    .from("orders")
    .update({
      status: refundedStatus,
      refunded_amount_minor: charge.amount_refunded,
      updated_at: ts,
    })
    .eq("id", orderId);

  await admin
    .from("payout_ledger")
    .update({
      status: nextLedgerStatus,
      refunded_amount_minor: charge.amount_refunded,
      refunded_at: ts,
      updated_at: ts,
    })
    .eq("id", orderId);

  await reverseReleasedPayoutIfRefunded(admin, orderId, charge);

  if (isFullRefund && order.user_id && order.course_id) {
    await admin
      .from("enrollments")
      .update({ status: "refunded", updated_at: ts })
      .eq("id", `${order.user_id}__${order.course_id}`);
  }
}

// --- terminal order status (expired / failed) with lock release + B2 guard --
async function markOrderStatus(
  admin: Admin,
  orderId: string | null | undefined,
  status: "failed" | "cancelled",
): Promise<void> {
  if (!orderId) return;
  const ts = nowIso();

  const { data: order } = await admin
    .from("orders")
    .select("status,user_id,course_id")
    .eq("id", orderId)
    .maybeSingle();

  // The order is always created before the Checkout session opens, so an absent
  // order means a bogus id — nothing to mark. ponytail: no partial insert (it
  // would violate NOT NULL on amount_minor/currency/user_id anyway).
  if (!order) return;

  // Release the checkout lock only if it still belongs to THIS order. [B3]
  if (order.user_id && order.course_id) {
    const lockKey = `${order.user_id}__${order.course_id}`;
    const { data: lock } = await admin
      .from("checkout_locks")
      .select("order_id")
      .eq("lock_key", lockKey)
      .maybeSingle();
    if (lock && shouldReleaseCheckoutLock(lock.order_id, orderId)) {
      await admin.from("checkout_locks").delete().eq("lock_key", lockKey);
    }
  }

  // Never overwrite a settled money outcome (paid/refunded). [B2]
  if (!shouldApplyOrderStatusTransition(order.status)) return;

  await admin.from("orders").update({ status, updated_at: ts }).eq("id", orderId);
}

// --- plan subscription sync (currentPlanId + commission) --------------------
async function uidFromCustomer(
  admin: Admin,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): Promise<string | null> {
  const customerId = typeof customer === "string" ? customer : customer.id;
  if (!customerId) return null;
  const { data } = await admin
    .from("users")
    .select("uid")
    .eq("stripe_customer_id", customerId)
    .limit(1)
    .maybeSingle();
  return data?.uid ?? null;
}

async function syncSubscriptionFromStripe(
  admin: Admin,
  subscription: Stripe.Subscription,
): Promise<void> {
  const uid =
    (subscription.metadata?.uid as string | undefined) ??
    (await uidFromCustomer(admin, subscription.customer));
  if (!uid) return;

  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = priceId ? planByStripePriceId(priceId) : null;
  const planId = plan?.id ?? null;
  const cycle = plan?.stripePriceIds
    ? plan.stripePriceIds.monthlyId === priceId
      ? "monthly"
      : plan.stripePriceIds.yearlyId === priceId
        ? "yearly"
        : null
    : null;
  if (!planId || !cycle || !priceId) return;

  const periodStart = secondsToIso(
    (item as { current_period_start?: number })?.current_period_start ??
      (subscription as unknown as { current_period_start?: number }).current_period_start,
  );
  const periodEnd = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as unknown as { current_period_end?: number }).current_period_end,
  );
  const ts = nowIso();

  await admin.from("subscriptions").upsert(
    {
      id: subscription.id,
      user_id: uid,
      plan_id: planId,
      cycle,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      status: subscription.status,
      past_due: subscription.status === "past_due" || subscription.status === "unpaid",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: ts,
    },
    { onConflict: "id" },
  );

  const entitled = subscription.status === "active" || subscription.status === "trialing";
  await admin
    .from("users")
    .update({ current_plan_id: entitled ? planId : "free", updated_at: ts })
    .eq("uid", uid);
}

async function handleInvoicePaymentFailed(
  admin: Admin,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const ts = nowIso();

  try {
    const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    if (subscription.metadata?.purpose === "course_subscription") {
      await admin
        .from("course_subscriptions")
        .update({ past_due: true, updated_at: ts })
        .eq("id", subscriptionId);
      return;
    }
  } catch {
    // fall through to plan-subscription handling
  }

  await admin
    .from("subscriptions")
    .update({ past_due: true, updated_at: ts })
    .eq("id", subscriptionId);
}

export async function POST(request: Request) {
  // Founder-gated dormant state: no key/secret yet. Stripe isn't calling this.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured.", code: "payments_not_configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  // Acknowledge unhandled types without an idempotency round-trip.
  if (!HANDLED_STRIPE_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const admin = getSupabaseAdminClient();
  try {
    const claim = await claimStripeEvent(admin, event.id);
    if (claim === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.mode !== "subscription") {
          await handleCheckoutCompleted(admin, session);
        }
        // subscription-mode sessions are owned by customer.subscription.* / invoice.paid
        break;
      }
      case "checkout.session.async_payment_failed":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "failed");
        break;
      case "checkout.session.expired":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "cancelled");
        break;
      case "payment_intent.payment_failed":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "failed");
        break;
      case "charge.refunded":
        await handleChargeRefunded(admin, event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscriptionObject = event.data.object;
        const handledAsCourse = await handleCourseSubscriptionLifecycle(
          admin,
          subscriptionObject,
        );
        if (!handledAsCourse) {
          await syncSubscriptionFromStripe(admin, subscriptionObject);
        }
        break;
      }
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(admin, event.data.object);
        break;
      case "invoice.paid":
        await handleCourseSubscriptionInvoicePaid(admin, event.data.object);
        break;
    }

    // Promote the marker to "done" ONLY after every handler ran without throwing.
    await markStripeEventDone(admin, event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handling failed", error);
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }
}

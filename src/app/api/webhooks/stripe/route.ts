import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { ACTIVATION_FEE_CHECKOUT_PURPOSE, planByStripePriceId } from "@/data/plans";
import { buildCourseSubscriptionSaleRecords } from "@/lib/payments/course-subscription-sale";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  canonicalPlatformFeeBpsForPlan,
  ledgerRefundStatus,
  nextLedgerStatusOnDispute,
  resolveInvoicePaymentIntentId,
  shouldCancelCourseSubscriptionForRefund,
  shouldApplyOrderStatusTransition,
  shouldMarkEnrollmentRefundedAfterChargeRefund,
  shouldReactivateEnrollment,
  shouldReleaseCheckoutLock,
  stripeFeeMinorFromBalanceTransaction,
  stripeProcessingFeeMinor,
} from "@/lib/payments/rules";
import { fromStripeAmount } from "@/lib/payments/currencies";
import { getStripeClient, isStripeConfigured } from "@/lib/payments/server/stripe";
import {
  courseSubscriptionInterval,
  ensureCourseSubscriptionCanceled,
} from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/stripe — the fulfilment core. Verifies the Stripe
// signature, dedupes via two-phase idempotency on processed_stripe_events
// (processing -> done), and fulfils each handled event with the service-role
// client. Idempotency inside each handler comes from writing the payout_ledger
// row LAST and checking it FIRST (the "re-arm guard"), plus existence-guarded
// enrollment writes — so a retried/redelivered event never double-fulfils.
//
// DIRECT CHARGES: sale events now originate on the TEACHER's connected account,
// so Stripe delivers them as Connect events carrying `event.account`. The money
// itself never touches a platform balance — Stripe settles the teacher and our
// application fee at capture time. This webhook therefore only RECORDS what
// already happened; it moves no money.
//
// `payout_ledger` survives as the earnings record that powers creator reports
// and the re-arm guard. It no longer holds funds: rows are written `settled`
// with no release date, there is no release cron, and a refund does not claw a
// transfer back (the refund debits the teacher's own balance at Stripe).

const HANDLED_STRIPE_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
  "account.updated",
]);

type Admin = ReturnType<typeof getSupabaseAdminClient>;

type SupabaseWrite = PromiseLike<{
  error: { message: string } | null;
}>;

async function requireSupabaseWrite(
  operation: SupabaseWrite,
  context: string,
): Promise<void> {
  const { error } = await operation;
  if (error) throw new Error(`${context}: ${error.message}`);
}

function nowIso(): string {
  return new Date().toISOString();
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
async function finalizeCourseCouponReservation(
  admin: Admin,
  orderId: string,
): Promise<void> {
  const { error } = await admin.rpc(
    "finalize_course_coupon_reservation",
    { p_order_id: orderId },
  );
  if (error) throw new Error(error.message);
}

async function releaseCourseCouponReservation(
  admin: Admin,
  orderId: string,
): Promise<void> {
  const { error } = await admin.rpc(
    "release_course_coupon_reservation",
    { p_order_id: orderId },
  );
  if (error) throw new Error(error.message);
}

/**
 * Subscription-mode sessions carry no orderId — the order row only exists once
 * the first invoice pays — so markOrderStatus returns immediately and the
 * reservation this checkout took would stay 'reserved' forever. Since
 * reserve_course_coupon counts reserved rows against max_redemptions, ten
 * abandoned subscription checkouts would kill a 10-use coupon that nobody ever
 * redeemed. The reservation id travels on the session metadata for exactly this
 * reason; the RPC is a no-op unless the row is still 'reserved', so a
 * redelivered event cannot undo a redemption.
 */
async function releaseAbandonedSubscriptionCoupon(
  admin: Admin,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription") return;
  const reservationId = session.metadata?.couponReservationId;
  if (typeof reservationId !== "string" || !reservationId) return;
  await releaseCourseCouponReservation(admin, reservationId);
}

/**
 * One-time storefront activation fee. A PLATFORM charge, so there is no
 * connected account and nothing to fulfil beyond stamping the column the SQL
 * publish gate reads (public.publish_teacher_course).
 *
 * Idempotent by the `is(..., null)` filter: a redelivered or replayed event
 * cannot move the recorded payment date, and Supabase reports zero matched rows
 * as success rather than an error.
 */
async function handleActivationFeePaid(
  admin: Admin,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const uid = session.metadata?.uid;
  if (!uid) {
    throw new Error("Activation fee checkout session is missing uid metadata.");
  }

  const ts = nowIso();
  await requireSupabaseWrite(
    admin
      .from("users")
      .update({ activation_fee_paid_at: ts, updated_at: ts })
      .eq("uid", uid)
      .is("activation_fee_paid_at", null),
    "Stamp storefront activation fee",
  );

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const { error: auditError } = await admin.rpc("log_audit_event", {
    p_action: "STOREFRONT_ACTIVATION_FEE_PAID",
    p_actor_id: uid,
    p_actor_email: "",
    p_target_type: "user",
    p_target_id: uid,
    p_summary: `Storefront activation fee paid by ${uid}`,
    p_metadata: {
      checkoutSessionId: session.id,
      paymentIntentId,
      amountTotal: session.amount_total,
      currency: session.currency,
    },
  });
  if (auditError) throw new Error(auditError.message);
}

async function handleCheckoutCompleted(
  admin: Admin,
  session: Stripe.Checkout.Session,
  connectedAccountId: string | null,
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const orderId = session.metadata?.orderId;
  const courseId = session.metadata?.courseId;
  const userId = session.metadata?.userId;
  if (!orderId || !courseId || !userId) {
    throw new Error("Missing required Checkout metadata.");
  }

  await finalizeCourseCouponReservation(admin, orderId);

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  // Re-arm guard: the ledger row is created exactly once per order (LAST,
  // below). If it already exists this order was fully fulfilled — a redelivery
  // / async event / replay must NOT re-run fulfilment.
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
  // Stripe's REAL processing fee, when the balance transaction is readable.
  // Our estimate is a US-shaped guess (2.9% / 5.4% + $0.30); a Brazilian or
  // Caribbean teacher pays local rates, and this number is what their wallet
  // displays as "you earned". Null = fall back to the estimate.
  let actualStripeFeeMinor: number | null = null;
  const receiptIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (receiptIntentId) {
    try {
      // Direct charges: the PaymentIntent belongs to the connected account, so
      // the lookup must carry the account header or it 404s.
      const intent = await getStripeClient().paymentIntents.retrieve(
        receiptIntentId,
        // Expanding the balance transaction here costs no extra round-trip: we
        // are already retrieving this PaymentIntent for the receipt url.
        { expand: ["latest_charge.balance_transaction"] },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
      const latestCharge = intent.latest_charge;
      if (latestCharge && typeof latestCharge !== "string") {
        receiptUrl = latestCharge.receipt_url ?? null;
        const balanceTransaction = latestCharge.balance_transaction;
        const rawFee = stripeFeeMinorFromBalanceTransaction(
          typeof balanceTransaction === "string" ? null : balanceTransaction,
          latestCharge.currency,
        );
        if (rawFee !== null) {
          actualStripeFeeMinor = fromStripeAmount(rawFee, latestCharge.currency);
        }
      }
    } catch {
      // ponytail: receipt lookup is best-effort; never blocks fulfilment.
    }
  }

  const grossAmountMinor = Number(order.amount_minor || 0);
  // ?? not || so an explicitly snapshotted 0-bps fee survives.
  const platformFeeBps = Number(order.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS);
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor =
    actualStripeFeeMinor ??
    stripeProcessingFeeMinor(grossAmountMinor, order.currency);
  // Under direct charges Stripe already deducted both our application fee and
  // its own processing fee from the teacher's settlement. This net is therefore
  // a RECORD of what the teacher actually received, not an amount we owe them.
  const netAmountMinor = Math.max(
    0,
    grossAmountMinor - skillsetFeeMinor - stripeFeeMinor,
  );
  const ts = nowIso();

  // payment (id = PaymentIntent), merge-safe.
  await requireSupabaseWrite(
    admin.from("payments").upsert(
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
    ),
    "Persist checkout payment",
  );

  await requireSupabaseWrite(
    admin
      .from("orders")
      .update({
        status: "paid",
        checkout_session_id: session.id,
        payment_intent_id: paymentIntentId,
        ...(receiptUrl ? { receipt_url: receiptUrl } : {}),
        paid_at: ts,
        updated_at: ts,
      })
      .eq("id", orderId),
    "Mark checkout order paid",
  );

  // Grant on first purchase; re-activate on repurchase after a refund/lapse;
  // never downgrade or reset progress on an already active/completed enrollment.
  // (ignoreDuplicates upsert used to skip existing rows entirely, so a learner
  // who repurchased after a refund was charged but stayed enrollment=refunded.)
  const enrollmentId = `${userId}__${courseId}`;
  const { data: existingEnrollment } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!existingEnrollment) {
    await requireSupabaseWrite(
      admin.from("enrollments").insert({
        id: enrollmentId,
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
      }),
      "Create checkout enrollment",
    );
  } else if (shouldReactivateEnrollment(existingEnrollment.status)) {
    await requireSupabaseWrite(
      admin
        .from("enrollments")
        .update({ status: "active", source: "payment", updated_at: ts })
        .eq("id", enrollmentId),
      "Reactivate checkout enrollment",
    );
  }

  // Earnings record LAST (the re-arm gate). Written `settled` with no release
  // date: the teacher was already paid by Stripe at capture. Legacy
  // amount_minor/platform_fee_minor are mirrored (gross / skillset fee) so the
  // table's CHECK holds.
  await requireSupabaseWrite(
    admin.from("payout_ledger").insert({
      id: orderId,
      teacher_id: course.owner_id,
      teacher_stripe_connected_account_id:
        connectedAccountId ||
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
      status: "settled",
      release_at: null,
      created_at: ts,
      updated_at: ts,
    }),
    "Create checkout earnings record",
  );

  // Release the in-flight checkout lock now that the purchase settled — only if
  // it still belongs to THIS order (a sibling attempt's lock must survive). [B3]
  const lockKey = `${userId}__${courseId}`;
  const { data: lock } = await admin
    .from("checkout_locks")
    .select("order_id")
    .eq("lock_key", lockKey)
    .maybeSingle();
  if (lock && shouldReleaseCheckoutLock(lock.order_id, orderId)) {
    await requireSupabaseWrite(
      admin.from("checkout_locks").delete().eq("lock_key", lockKey),
      "Release settled checkout lock",
    );
  }
}

// --- course-subscription invoice fulfilment ---------------------------------
async function handleCourseSubscriptionInvoicePaid(
  admin: Admin,
  invoice: Stripe.Invoice,
  eventAccountId: string | null,
): Promise<void> {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const stripe = getStripeClient();
  // Direct charges: the subscription lives on the teacher's connected account
  // and is invisible to a platform-scoped retrieve. event.account is the only
  // source of that id here — meta.connectedAccountId sits inside the object we
  // cannot read yet.
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId,
    undefined,
    eventAccountId ? { stripeAccount: eventAccountId } : undefined,
  );
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

  // ?? / isFinite, not || — legacy metadata "0" (old 0-bps Plus subscriptions)
  // is a valid snapshotted fee and must not coerce to the default.
  const metaBps = Number(meta.platformFeeBps || NaN); // "" / undefined -> NaN, "0" -> 0
  // Fallback chain, used only when the invoice does not state the fee itself.
  const derivedFeeBps = owner
    ? canonicalPlatformFeeBpsForPlan(owner.current_plan_id)
    : Number.isFinite(metaBps) && metaBps >= 0
      ? metaBps
      : DEFAULT_PLATFORM_FEE_BPS;
  // event.account first: it is where the money actually moved, so it outranks
  // any snapshotted id that may be stale.
  const connectedAccountId =
    eventAccountId ||
    (typeof meta.connectedAccountId === "string" && meta.connectedAccountId) ||
    course.stripe_connected_account_id ||
    owner?.stripe_connected_account_id ||
    null;

  const currencyUpper = String(invoice.currency || "USD").toUpperCase();
  // Stripe's smallest unit, not ours. A ¥1,000 renewal arrives as 1000; storing
  // it raw would show the teacher ¥10 in the ledger and book our commission
  // 100x too low on every renewal.
  const grossAmountMinor = fromStripeAmount(
    Number(invoice.amount_paid || 0),
    currencyUpper,
  );
  // Stripe freezes application_fee_percent when the subscription is created and
  // keeps charging that percent on every renewal. Recomputing the fee from the
  // teacher's CURRENT plan would book a number Stripe never took: a teacher who
  // upgrades Free (10%) -> Pro (3%) is still charged 10% by Stripe until the
  // subscription is re-created, and the ledger would claim 3% while 10% left the
  // charge. The subscription states the percent actually in force, so trust it;
  // the plan/metadata chain only covers subscriptions with no percent set.
  const frozenPercent = subscription.application_fee_percent;
  const platformFeeBps =
    typeof frozenPercent === "number" && frozenPercent >= 0
      ? Math.round(frozenPercent * 100)
      : derivedFeeBps;
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor =
    grossAmountMinor > 0 ? stripeProcessingFeeMinor(grossAmountMinor, currencyUpper) : 0;
  // Record of what the teacher actually received: Stripe already took our
  // application fee and its own processing fee out of the direct charge.
  const netAmountMinor = Math.max(
    0,
    grossAmountMinor - skillsetFeeMinor - stripeFeeMinor,
  );

  // Resolve the REAL PaymentIntent so the ledger join key matches the refund
  // clawback (charge.payment_intent). Throw when a payout-bearing ledger would
  // otherwise store a degraded (invoice-id) key — forces Stripe redelivery.
  let resolvedPaymentIntentId = resolveInvoicePaymentIntentId(invoice);
  if (!resolvedPaymentIntentId && invoice.id) {
    const ledgerWillBeWritten = grossAmountMinor > 0 && Boolean(connectedAccountId);
    try {
      // Direct charges: the invoice lives on the connected account.
      const expanded = await stripe.invoices.retrieve(
        invoice.id,
        { expand: ["payments"] },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
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

  if (!invoice.id) {
    throw new Error("course_subscription invoice is missing its Stripe id.");
  }

  const saleRecords = buildCourseSubscriptionSaleRecords({
    invoiceId: invoice.id,
    paymentId,
    paymentIntentId: resolvedPaymentIntentId,
    subscriptionId,
    userId,
    teacherId,
    connectedAccountId,
    courseId,
    courseSlug: course.slug || courseId,
    courseTitle: course.title,
    grossAmountMinor,
    currency: currencyUpper,
    platformFeeBps,
    createdAt: secondsToIso(invoice.created) ?? ts,
    paidAt: secondsToIso(invoice.status_transitions?.paid_at) ?? ts,
    updatedAt: ts,
  });

  // Every renewal is a first-class sale. Insert-only upserts make redelivery
  // safe and avoid changing an invoice that was subsequently refunded.
  const { error: orderError } = await admin
    .from("orders")
    .upsert(saleRecords.order, { onConflict: "id", ignoreDuplicates: true });
  if (orderError) throw new Error(orderError.message);

  const { error: paymentRecordError } = await admin
    .from("payments")
    .upsert(saleRecords.payment, { onConflict: "id", ignoreDuplicates: true });
  if (paymentRecordError) throw new Error(paymentRecordError.message);

  // Record this invoice's earnings — keyed by invoice id (one per invoice,
  // idempotent against retries). Skip if it exists, gross 0, or no connected
  // account. Nothing is held: Stripe already settled the teacher.
  if (invoice.id && grossAmountMinor > 0 && connectedAccountId) {
    const { data: existingLedger } = await admin
      .from("payout_ledger")
      .select("id")
      .eq("id", invoice.id)
      .maybeSingle();
    if (!existingLedger) {
      const { error: ledgerInsertError } = await admin.from("payout_ledger").insert({
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
        status: "settled",
        release_at: null,
        created_at: ts,
        updated_at: ts,
      });
      if (ledgerInsertError) throw new Error(ledgerInsertError.message);
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
    await requireSupabaseWrite(
      admin.from("enrollments").insert({
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
      }),
      "Create subscription enrollment",
    );
  } else if (shouldReactivateEnrollment(enrollment.status)) {
    await requireSupabaseWrite(
      admin
        .from("enrollments")
        .update({
          status: "active",
          source: "subscription",
          subscription_id: subscriptionId,
          updated_at: ts,
        })
        .eq("id", enrollmentId),
      "Reactivate subscription enrollment",
    );
  }

  // Mirror the subscription for the learner's cancel UI + lifecycle handler.
  await requireSupabaseWrite(
    admin.from("course_subscriptions").upsert(
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
    ),
    "Persist paid course subscription",
  );

  // Burn the coupon on the FIRST paid invoice only. The Stripe coupon is
  // duration:"once", so renewals carry the same metadata but no discount —
  // finalizing on every invoice would count one buyer against the redemption
  // cap forever. The RPC is idempotent, the billing_reason gate is the intent.
  if (
    invoice.billing_reason === "subscription_create"
    && typeof meta.couponReservationId === "string"
    && meta.couponReservationId
  ) {
    await finalizeCourseCouponReservation(admin, meta.couponReservationId);
  }
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

  await requireSupabaseWrite(
    admin.from("course_subscriptions").upsert(
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
    ),
    "Persist course subscription lifecycle",
  );

  const enrollmentId = `${userId}__${courseId}`;
  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (!enrollment) return true; // invoice.paid creates it; lifecycle never creates

  const enrollmentStatus = String(enrollment.status ?? "");
  if (revoke && enrollmentStatus === "active") {
    await requireSupabaseWrite(
      admin
        .from("enrollments")
        .update({ status: "revoked", updated_at: ts })
        .eq("id", enrollmentId),
      "Revoke course subscription enrollment",
    );
  } else if (entitled && enrollmentStatus === "revoked") {
    await requireSupabaseWrite(
      admin
        .from("enrollments")
        .update({
          status: "active",
          source: "subscription",
          subscription_id: subscription.id,
          updated_at: ts,
        })
        .eq("id", enrollmentId),
      "Restore course subscription enrollment",
    );
  }
  return true;
}

// --- charge.refunded ---------------------------------------------------------
// Under direct charges a refund debits the TEACHER's own Stripe balance, and
// Stripe returns the proportional application fee to them automatically when
// the refund is issued with `refund_application_fee`. There is no platform-held
// money to claw back and no transfer to reverse — this handler only records the
// refund and revokes access.
async function handleChargeRefunded(
  admin: Admin,
  charge: Stripe.Charge,
  connectedAccountId: string | null,
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  // The activation fee is a PLATFORM charge with no payments row: without this
  // branch the lookup below finds nothing, falls through to the ledger path,
  // finds no course_subscription ledger and returns — leaving the creator with
  // a storefront they were refunded for. Stripe copies the PaymentIntent
  // metadata onto the charge (see payments/activation/checkout/route.ts), so
  // {uid, purpose} is already here: no extra API call.
  // ponytail: refunds only. A LOST DISPUTE on the fee does not fire
  // charge.refunded and still leaves the storefront active — add the same check
  // to handleDisputeClosed (needs a PaymentIntent fetch) if chargebacks appear.
  if (charge.metadata?.purpose === ACTIVATION_FEE_CHECKOUT_PURPOSE) {
    const activationUid = charge.metadata?.uid;
    // Partial refund does not revoke: they still paid for the storefront.
    if (activationUid && charge.refunded === true) {
      const revokedAt = nowIso();
      await requireSupabaseWrite(
        admin
          .from("users")
          .update({ activation_fee_paid_at: null, updated_at: revokedAt })
          .eq("uid", activationUid),
        "Revoke storefront activation after refund",
      );
      const { error: auditError } = await admin.rpc("log_audit_event", {
        p_action: "STOREFRONT_ACTIVATION_FEE_REFUNDED",
        p_actor_id: activationUid,
        p_actor_email: "",
        p_target_type: "user",
        p_target_id: activationUid,
        p_summary: `Storefront activation revoked after refund for ${activationUid}`,
        p_metadata: {
          chargeId: charge.id,
          paymentIntentId,
          amountRefunded: charge.amount_refunded,
          currency: charge.currency,
        },
      });
      if (auditError) throw new Error(auditError.message);
    }
    return;
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);

  const isFullRefund = charge.refunded === true;
  const refundedStatus = isFullRefund ? "refunded" : "partially_refunded";
  const ts = nowIso();
  // Stripe's smallest unit, not ours. This value is stored as
  // refunded_amount_minor and later SUBTRACTED from order.amount_minor (which is
  // in our units) to cap the next partial refund — so on a zero-decimal currency
  // an unconverted total makes a ¥500 refund look like ¥5 and lets the cap pass
  // a second refund that over-refunds the order.
  const refundedAmountMinor = fromStripeAmount(
    Number(charge.amount_refunded || 0),
    String(charge.currency || "USD"),
  );

  if (!payment) {
    // Subscription invoice charge refunded from the Dashboard: no payments doc.
    // Find the subscription earnings record (paymentId == PI, kind
    // subscription) and mark it refunded.
    const { data: ledgers, error: ledgersError } = await admin
      .from("payout_ledger")
      .select("id,status,kind,subscription_id")
      .eq("payment_id", paymentIntentId)
      .limit(5);
    if (ledgersError) throw new Error(ledgersError.message);
    const ledger = (ledgers ?? []).find((l) => l.kind === "course_subscription");
    if (!ledger) return;
    await requireSupabaseWrite(
      admin
        .from("payout_ledger")
        .update({
          status: ledgerRefundStatus(isFullRefund),
          refunded_amount_minor: refundedAmountMinor,
          refunded_at: ts,
          updated_at: ts,
        })
        .eq("id", ledger.id),
      "Update subscription refund ledger",
    );
    if (
      shouldCancelCourseSubscriptionForRefund({
        isFullRefund,
        ledgerKind: ledger.kind,
        subscriptionId: ledger.subscription_id,
      })
    ) {
      await ensureCourseSubscriptionCanceled(
        getStripeClient(),
        String(ledger.subscription_id),
        connectedAccountId,
      );
    }
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

  const { data: ledger, error: ledgerError } = await admin
    .from("payout_ledger")
    .select("status,kind,subscription_id")
    .eq("id", orderId)
    .maybeSingle();
  if (ledgerError) throw new Error(ledgerError.message);
  const nextLedgerStatus = ledgerRefundStatus(isFullRefund);

  await requireSupabaseWrite(
    admin
      .from("payments")
      .update({
        status: refundedStatus,
        refunded_amount_minor: refundedAmountMinor,
        refunded_at: ts,
        updated_at: ts,
      })
      .eq("id", paymentIntentId),
    "Update refunded payment",
  );

  await requireSupabaseWrite(
    admin
      .from("orders")
      .update({
        status: refundedStatus,
        refunded_amount_minor: refundedAmountMinor,
        updated_at: ts,
      })
      .eq("id", orderId),
    "Update refunded order",
  );

  await requireSupabaseWrite(
    admin
      .from("payout_ledger")
      .update({
        status: nextLedgerStatus,
        refunded_amount_minor: refundedAmountMinor,
        refunded_at: ts,
        updated_at: ts,
      })
      .eq("id", orderId),
    "Update refunded earnings record",
  );

  if (
    shouldCancelCourseSubscriptionForRefund({
      isFullRefund,
      ledgerKind: ledger?.kind,
      subscriptionId: ledger?.subscription_id,
    })
  ) {
    await ensureCourseSubscriptionCanceled(
      getStripeClient(),
      String(ledger?.subscription_id),
      connectedAccountId,
    );
  }

  if (
    shouldMarkEnrollmentRefundedAfterChargeRefund({
      isFullRefund,
      ledgerKind: ledger?.kind,
    })
    && order.user_id
    && order.course_id
  ) {
    await requireSupabaseWrite(
      admin
        .from("enrollments")
        .update({ status: "refunded", updated_at: ts })
        .eq("id", `${order.user_id}__${order.course_id}`),
      "Refund course enrollment",
    );
  }
}

// --- card disputes (chargebacks) --------------------------------------------
// Under direct charges a dispute debits the TEACHER's own Stripe balance —
// the platform never held the funds. These handlers only record the contested
// state on the earnings ledger so creator reports stay truthful.
async function resolveLedgerForDispute(
  admin: Admin,
  dispute: Stripe.Dispute,
): Promise<{ id: string; status: string } | null> {
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!paymentIntentId) return null;
  const { data, error } = await admin
    .from("payout_ledger")
    .select("id,status")
    .eq("payment_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; status: string } | null) ?? null;
}

async function handleDisputeCreated(admin: Admin, dispute: Stripe.Dispute): Promise<void> {
  const ledger = await resolveLedgerForDispute(admin, dispute);
  if (!ledger) return;
  const next = nextLedgerStatusOnDispute({
    event: "created",
    currentStatus: ledger.status,
  });
  if (!next) return;
  await requireSupabaseWrite(
    admin
      .from("payout_ledger")
      .update({ status: next, updated_at: nowIso() })
      .eq("id", ledger.id),
    "Mark earnings disputed",
  );
  // No clawback: under direct charges the disputed funds are debited from the
  // TEACHER's Stripe balance by Stripe itself — the platform never held them,
  // so there is nothing here to reverse. This handler only records the state so
  // creator reports show the sale as contested.
}

async function handleDisputeClosed(admin: Admin, dispute: Stripe.Dispute): Promise<void> {
  const event =
    dispute.status === "won" ? "won" : dispute.status === "lost" ? "lost" : null;
  if (!event) return; // warning_closed etc.: no money movement to settle
  const ledger = await resolveLedgerForDispute(admin, dispute);
  if (!ledger) return;
  const next = nextLedgerStatusOnDispute({
    event,
    currentStatus: ledger.status,
  });
  if (!next) return;
  await requireSupabaseWrite(
    admin
      .from("payout_ledger")
      .update({ status: next, updated_at: nowIso() })
      .eq("id", ledger.id),
    "Resolve payout dispute",
  );
}

// --- terminal order status (expired / failed) with lock release + B2 guard --
async function markOrderStatus(
  admin: Admin,
  orderId: string | null | undefined,
  status: "failed" | "cancelled",
): Promise<void> {
  if (!orderId) return;
  const ts = nowIso();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("status,user_id,course_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);

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
      await requireSupabaseWrite(
        admin.from("checkout_locks").delete().eq("lock_key", lockKey),
        "Release failed checkout lock",
      );
    }
  }

  // Never overwrite a settled money outcome (paid/refunded). [B2]
  if (!shouldApplyOrderStatusTransition(order.status)) return;

  await releaseCourseCouponReservation(admin, orderId);
  await requireSupabaseWrite(
    admin.from("orders").update({ status, updated_at: ts }).eq("id", orderId),
    "Mark checkout order terminal",
  );
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

  await requireSupabaseWrite(
    admin.from("subscriptions").upsert(
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
    ),
    "Persist plan subscription",
  );

  // Entitlement must reflect ALL of this user's live subscriptions, not just the
  // one in this event. Stripe checkout never replaces an existing subscription,
  // so an upgraded creator holds two rows: cancelling the old cheap one fires
  // subscription.deleted for it, and writing `entitled ? planId : "free"` from
  // that single event would drop a paying Pro customer to free (and an
  // `updated` event on the cheaper sub would overwrite the higher plan). The
  // upsert above already made this row current, so resolve from the table and
  // keep the best live tier. Lower platform fee = higher tier; unknown plan ids
  // tie with free and lose the strict comparison.
  const { data: liveSubscriptions, error: liveSubscriptionsError } = await admin
    .from("subscriptions")
    .select("plan_id")
    .eq("user_id", uid)
    .in("status", ["active", "trialing"]);
  if (liveSubscriptionsError) throw new Error(liveSubscriptionsError.message);

  const effectivePlanId = (liveSubscriptions ?? []).reduce<string>((best, row) => {
    const candidate = row.plan_id as string | null;
    if (!candidate) return best;
    return canonicalPlatformFeeBpsForPlan(candidate) < canonicalPlatformFeeBpsForPlan(best)
      ? candidate
      : best;
  }, "free");

  await requireSupabaseWrite(
    admin
      .from("users")
      .update({ current_plan_id: effectivePlanId, updated_at: ts })
      .eq("uid", uid),
    "Update subscriber plan",
  );
}

async function handleInvoicePaymentFailed(
  admin: Admin,
  invoice: Stripe.Invoice,
  eventAccountId: string | null,
): Promise<void> {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const ts = nowIso();

  let subscription: Stripe.Subscription | null = null;
  try {
    // Course subscriptions live on the connected account (direct charges);
    // plan subscriptions live on the platform, where event.account is null.
    subscription = await getStripeClient().subscriptions.retrieve(
      subscriptionId,
      undefined,
      eventAccountId ? { stripeAccount: eventAccountId } : undefined,
    );
  } catch {
    // fall through to plan-subscription handling
  }

  if (subscription?.metadata?.purpose === "course_subscription") {
    await requireSupabaseWrite(
      admin
        .from("course_subscriptions")
        .update({ past_due: true, updated_at: ts })
        .eq("id", subscriptionId),
      "Mark course subscription past due",
    );
    return;
  }

  await requireSupabaseWrite(
    admin
      .from("subscriptions")
      .update({ past_due: true, updated_at: ts })
      .eq("id", subscriptionId),
    "Mark plan subscription past due",
  );
}

async function handleConnectedAccountUpdated(
  admin: Admin,
  account: Stripe.Account,
): Promise<void> {
  const ts = nowIso();
  const ready = Boolean(account.charges_enabled && account.payouts_enabled);

  await requireSupabaseWrite(
    admin
      .from("users")
      .update({
        stripe_connect_status: ready ? "ready" : "onboarding_required",
        stripe_connect_charges_enabled: Boolean(account.charges_enabled),
        stripe_connect_payouts_enabled: Boolean(account.payouts_enabled),
        stripe_connect_updated_at: ts,
        updated_at: ts,
      })
      .eq("stripe_connected_account_id", account.id),
    "Sync connected account readiness",
  );
}

function constructStripeWebhookEvent(
  rawBody: string,
  signature: string,
  webhookSecrets: string[],
): Stripe.Event | null {
  const stripe = getStripeClient();

  for (const secret of webhookSecrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      // Stripe assigns a distinct signing secret to each webhook endpoint.
    }
  }

  return null;
}

export async function POST(request: Request) {
  const webhookSecrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  if (!isStripeConfigured() || webhookSecrets.length === 0) {
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
  const event = constructStripeWebhookEvent(rawBody, signature, webhookSecrets);
  if (!event) {
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

    // Connect events carry the connected account that owns the object. Sale
    // events now originate there (direct charges), so every downstream Stripe
    // read/write must be made against this account. Null for platform-level
    // events such as account.updated and platform billing.
    const eventAccountId = event.account ?? null;

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.metadata?.purpose === ACTIVATION_FEE_CHECKOUT_PURPOSE) {
          // Platform fee, not a course sale. Must be discriminated BEFORE
          // handleCheckoutCompleted: that handler requires orderId/courseId/
          // userId metadata and throws without them, which would 500 the webhook
          // and leave Stripe retrying the event forever.
          await handleActivationFeePaid(admin, session);
        } else if (session.mode !== "subscription") {
          await handleCheckoutCompleted(admin, session, eventAccountId);
        }
        // subscription-mode sessions are owned by customer.subscription.* / invoice.paid
        break;
      }
      case "checkout.session.async_payment_failed":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "failed");
        await releaseAbandonedSubscriptionCoupon(admin, event.data.object);
        break;
      case "checkout.session.expired":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "cancelled");
        await releaseAbandonedSubscriptionCoupon(admin, event.data.object);
        break;
      case "payment_intent.payment_failed":
        await markOrderStatus(admin, event.data.object.metadata?.orderId, "failed");
        break;
      case "charge.refunded":
        await handleChargeRefunded(admin, event.data.object, eventAccountId);
        break;
      case "charge.dispute.created":
        await handleDisputeCreated(admin, event.data.object);
        break;
      case "charge.dispute.closed":
        await handleDisputeClosed(admin, event.data.object);
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
        await handleInvoicePaymentFailed(
          admin,
          event.data.object,
          eventAccountId,
        );
        break;
      case "invoice.paid":
        await handleCourseSubscriptionInvoicePaid(
          admin,
          event.data.object,
          eventAccountId,
        );
        break;
      case "account.updated":
        await handleConnectedAccountUpdated(admin, event.data.object);
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

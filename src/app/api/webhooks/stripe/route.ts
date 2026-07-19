import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  affiliateCommissionLedgerId,
  parseAffiliateSettlementFromMetadata,
  teacherNetAfterAffiliate,
} from "@/domain/affiliate-attribution";
import { planByStripePriceId } from "@/data/plans";
import { buildCourseSubscriptionSaleRecords } from "@/lib/payments/course-subscription-sale";
import { defaultSkillsetCurrency } from "@/lib/payments/currencies";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  affiliateCommissionRefundTargetMinor,
  canonicalPlatformFeeBpsForPlan,
  createReleasedRefundTransferReversal,
  ledgerRefundStatus,
  nextLedgerStatusOnDispute,
  payoutReleaseDelayDays,
  releasedRefundReversalAmountMinor,
  refundReversalClaimKey,
  resolveInvoicePaymentIntentId,
  shouldCancelCourseSubscriptionForRefund,
  shouldApplyOrderStatusTransition,
  shouldMarkEnrollmentRefundedAfterChargeRefund,
  shouldReactivateEnrollment,
  shouldReleaseCheckoutLock,
  shouldReverseReleasedPayout,
  stripeProcessingFeeMinor,
  type TransferReversalStripeClient,
} from "@/lib/payments/rules";
import { getStripeClient, isStripeConfigured } from "@/lib/payments/server/stripe";
import {
  courseSubscriptionInterval,
  ensureCourseSubscriptionCanceled,
} from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/stripe — the money core. Faithful port of the stripeWebhook
// Firebase HTTPS function (functions/src/index.ts). Verifies the Stripe
// signature, dedupes via two-phase idempotency on processed_stripe_events
// (processing -> done), and fulfils each handled event with the service-role
// client. Idempotency inside each handler comes from writing the payout_ledger
// row LAST and checking it FIRST (the "re-arm guard"), plus existence-guarded
// enrollment writes — so a retried/redelivered event never double-fulfils.
//
// The release engine (/api/cron/release-payouts) moves cleared payouts;
// charge.refunded and charge.dispute.* claw back an already-released transfer
// proportionally (reverseReleasedPayout, below). The only remaining
// simplification is the payout-delay platformConfig read — default
// payoutReleaseDelayDays window (see src/lib/payments/rules.ts).

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

type RefundReversalClaimRow = {
  action: "skip" | "execute";
  planned_amount_minor: number | string | null;
};

async function claimRefundTransferReversal(
  admin: Admin,
  args: {
    ledgerId: string;
    claimKey: string;
    targetReversalAmountMinor: number;
  },
): Promise<number> {
  const result = (await admin.rpc(
    "claim_payout_transfer_reversal",
    {
      p_ledger_id: args.ledgerId,
      p_claim_key: args.claimKey,
      p_target_amount_minor: args.targetReversalAmountMinor,
    },
  )) as unknown as {
    data: RefundReversalClaimRow[] | RefundReversalClaimRow | null;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || row.action === "skip") return 0;

  const plannedAmountMinor = Number(row.planned_amount_minor ?? 0);
  if (!Number.isFinite(plannedAmountMinor) || plannedAmountMinor <= 0) {
    throw new Error("Refund reversal claim returned an invalid planned amount.");
  }
  return Math.floor(plannedAmountMinor);
}

async function completeRefundTransferReversal(
  admin: Admin,
  args: { ledgerId: string; claimKey: string; reversalId: string },
): Promise<void> {
  const result = (await admin.rpc(
    "complete_payout_transfer_reversal",
    {
      p_ledger_id: args.ledgerId,
      p_claim_key: args.claimKey,
      p_reversal_id: args.reversalId,
    },
  )) as unknown as { error: { message: string } | null };
  if (result.error) throw new Error(result.error.message);
}

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

/**
 * Settle affiliate commission into payout_ledger (kind=affiliate_commission).
 * Idempotent on `${saleRootId}__aff`. Uses metadata stamped at checkout.
 * Does not create Connect transfers — release-payouts cron handles that later
 * when the affiliate has a connected account (teacher_id = affiliate uid).
 */
async function settleAffiliateCommissionLedger(
  admin: Admin,
  args: {
    saleRootId: string;
    courseId: string;
    paymentId: string;
    currency: string;
    grossAmountMinor: number;
    metadata: Record<string, string | undefined> | null | undefined;
    buyerUserId?: string | null;
    teacherUserId?: string | null;
    invoiceId?: string | null;
    subscriptionId?: string | null;
    paymentIdIsPaymentIntent?: boolean;
  },
): Promise<number> {
  const settled = parseAffiliateSettlementFromMetadata(
    args.metadata,
    args.grossAmountMinor,
    { buyerUserId: args.buyerUserId, teacherUserId: args.teacherUserId },
  );
  if (!settled) return 0;

  const ledgerId = affiliateCommissionLedgerId(args.saleRootId);
  const { data: existing } = await admin
    .from("payout_ledger")
    .select("id")
    .eq("id", ledgerId)
    .maybeSingle();
  if (existing) return settled.commissionMinor;

  // Prefer affiliate's connected account when present (release cron uses it).
  const { data: affiliateUser } = await admin
    .from("users")
    .select("stripe_connected_account_id")
    .eq("uid", settled.affiliateUserId)
    .maybeSingle();

  const ts = nowIso();
  const commission = settled.commissionMinor;
  const { error } = await admin.from("payout_ledger").insert({
    id: ledgerId,
    teacher_id: settled.affiliateUserId,
    teacher_stripe_connected_account_id:
      affiliateUser?.stripe_connected_account_id || null,
    course_id: args.courseId,
    order_id: args.saleRootId,
    invoice_id: args.invoiceId ?? null,
    subscription_id: args.subscriptionId ?? null,
    payment_id: args.paymentId,
    payment_id_is_payment_intent: Boolean(args.paymentIdIsPaymentIntent),
    kind: "affiliate_commission",
    amount_minor: commission,
    platform_fee_minor: 0,
    gross_amount_minor: commission,
    skillset_fee_minor: 0,
    stripe_fee_minor: 0,
    net_amount_minor: commission,
    currency: args.currency,
    platform_fee_bps: 0,
    status: "in_release",
    release_at: getPayoutReleaseAt(),
    created_at: ts,
    updated_at: ts,
  });
  if (error) {
    // Unique race on redelivery — treat as settled.
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      return commission;
    }
    throw new Error(error.message);
  }
  return commission;
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

  await finalizeCourseCouponReservation(admin, orderId);

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  // Re-arm guard: the ledger is created exactly once per order (LAST, below). If
  // it already exists this order was fully fulfilled — a redelivery / async
  // event / replay must NOT re-run fulfilment (would re-schedule a payout for
  // possibly-refunded money). Still repair affiliate settlement if missing.
  const { data: existingLedger } = await admin
    .from("payout_ledger")
    .select("id,gross_amount_minor,currency")
    .eq("id", orderId)
    .maybeSingle();
  if (existingLedger) {
    await settleAffiliateCommissionLedger(admin, {
      saleRootId: orderId,
      courseId,
      paymentId: paymentIntentId,
      currency: String(existingLedger.currency || defaultSkillsetCurrency).toUpperCase(),
      grossAmountMinor: Number(existingLedger.gross_amount_minor || 0),
      metadata: (session.metadata ?? {}) as Record<string, string | undefined>,
      buyerUserId: userId,
      teacherUserId: session.metadata?.teacherId ?? null,
      paymentIdIsPaymentIntent: true,
    });
    return;
  }

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
  // ?? not || so an explicitly snapshotted 0-bps fee survives.
  const platformFeeBps = Number(order.platform_fee_bps ?? DEFAULT_PLATFORM_FEE_BPS);
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor = stripeProcessingFeeMinor(grossAmountMinor, order.currency);
  const sessionMeta = (session.metadata ?? {}) as Record<string, string | undefined>;
  const affiliatePreview = parseAffiliateSettlementFromMetadata(
    sessionMeta,
    grossAmountMinor,
    { buyerUserId: userId, teacherUserId: order.teacher_id ?? course.owner_id },
  );
  const affiliateCommissionMinor = affiliatePreview?.commissionMinor ?? 0;
  const netAmountMinor = teacherNetAfterAffiliate(
    Math.max(0, grossAmountMinor - skillsetFeeMinor - stripeFeeMinor),
    affiliateCommissionMinor,
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

  // Ledger LAST (the re-arm gate). Legacy amount_minor/platform_fee_minor are
  // mirrored (gross / skillset fee) so the table's CHECK holds.
  // Teacher net is reduced by affiliate commission when metadata attributes a ref.
  await requireSupabaseWrite(
    admin.from("payout_ledger").insert({
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
    }),
    "Create checkout payout ledger",
  );

  await settleAffiliateCommissionLedger(admin, {
    saleRootId: orderId,
    courseId,
    paymentId: paymentIntentId,
    currency: String(order.currency || defaultSkillsetCurrency).toUpperCase(),
    grossAmountMinor,
    metadata: sessionMeta,
    buyerUserId: userId,
    teacherUserId: order.teacher_id ?? course.owner_id,
    paymentIdIsPaymentIntent: true,
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

  // ?? / isFinite, not || — legacy metadata "0" (old 0-bps Plus subscriptions)
  // is a valid snapshotted fee and must not coerce to the default.
  const metaBps = Number(meta.platformFeeBps || NaN); // "" / undefined -> NaN, "0" -> 0
  const platformFeeBps = owner
    ? canonicalPlatformFeeBpsForPlan(owner.current_plan_id)
    : Number.isFinite(metaBps) && metaBps >= 0
      ? metaBps
      : DEFAULT_PLATFORM_FEE_BPS;
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
  const subMeta = (meta ?? {}) as Record<string, string | undefined>;
  const affiliatePreview = parseAffiliateSettlementFromMetadata(
    subMeta,
    grossAmountMinor,
    { buyerUserId: userId, teacherUserId: teacherId },
  );
  const affiliateCommissionMinor = affiliatePreview?.commissionMinor ?? 0;
  const netAmountMinor = teacherNetAfterAffiliate(
    Math.max(0, grossAmountMinor - skillsetFeeMinor - stripeFeeMinor),
    affiliateCommissionMinor,
  );

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
        status: "in_release",
        release_at: getPayoutReleaseAt(),
        created_at: ts,
        updated_at: ts,
      });
      if (ledgerInsertError) throw new Error(ledgerInsertError.message);
    }

    // Affiliate commission for this invoice (first charge + renewals use sub metadata).
    await settleAffiliateCommissionLedger(admin, {
      saleRootId: invoice.id,
      courseId,
      paymentId,
      currency: currencyUpper,
      grossAmountMinor,
      metadata: subMeta,
      buyerUserId: userId,
      teacherUserId: teacherId,
      invoiceId: invoice.id,
      subscriptionId,
      paymentIdIsPaymentIntent: Boolean(resolvedPaymentIntentId),
    });
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

/**
 * Mark affiliate commission ledger refunded + reverse transfer if already paid.
 * saleRootId = order id (one-time) or invoice id (subscription).
 */
async function clawbackAffiliateCommissionLedger(
  admin: Admin,
  saleRootId: string,
  opts: {
    refundedAmountMinor: number;
    saleGrossAmountMinor: number;
    sourceId: string;
    isFullRefund: boolean;
  },
): Promise<void> {
  const affId = affiliateCommissionLedgerId(saleRootId);
  const { data: affLedger, error } = await admin
    .from("payout_ledger")
    .select("id,status,net_amount_minor,refunded_amount_minor")
    .eq("id", affId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!affLedger) return;

  const ts = nowIso();
  const nextStatus = ledgerRefundStatus(opts.isFullRefund, affLedger.status);
  // Full refund → claw entire commission; partial → proportional floor.
  const commissionMinor = Number(affLedger.net_amount_minor || 0);
  const clawMinor = affiliateCommissionRefundTargetMinor({
    commissionAmountMinor: commissionMinor,
    saleGrossAmountMinor: opts.saleGrossAmountMinor,
    refundedSaleAmountMinor: opts.isFullRefund
      ? opts.saleGrossAmountMinor
      : opts.refundedAmountMinor,
    alreadyRefundedCommissionMinor: Number(
      affLedger.refunded_amount_minor || 0,
    ),
  });

  await requireSupabaseWrite(
    admin
      .from("payout_ledger")
      .update({
        status: nextStatus,
        refunded_amount_minor: clawMinor,
        refunded_at: ts,
        updated_at: ts,
      })
      .eq("id", affId),
    "Update affiliate refund ledger",
  );

  if (clawMinor > 0) {
    await reverseReleasedPayout(admin, affId, {
      refundedAmountMinor: clawMinor,
      sourceId: opts.sourceId,
      reason: "refund_affiliate",
    });
  }
}

// --- released-transfer clawback (refund or dispute) -------------------------
// Claw back an already-released payout when its sale is refunded. Only a
// released transfer (money that actually left the platform) can be reversed; an
// in_release/releasing payout is simply reduced by the release engine. Keyed by
// (chargeId, cumulative amount_refunded) in refund_reversal_claims so a Stripe
// redelivery of the same refund never double-reverses.
// The claim RPC locks the ledger and reserves the cumulative target before the
// Stripe call. A retry receives the same planned amount and reuses the same
// Stripe idempotency key; completion only promotes that claim to done.
async function reverseReleasedPayout(
  admin: Admin,
  ledgerId: string,
  opts: { refundedAmountMinor: number; sourceId: string; reason: string },
): Promise<void> {
  const { data: ledger, error: ledgerError } = await admin
    .from("payout_ledger")
    .select(
      "status,transfer_id,transfer_amount_minor,gross_amount_minor,net_amount_minor,transfer_reversed_amount_minor,refund_reversal_claims,order_id,course_id,teacher_id",
    )
    .eq("id", ledgerId)
    .maybeSingle();
  if (ledgerError) throw new Error(ledgerError.message);
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

  const claimKey = refundReversalClaimKey(opts.sourceId, opts.refundedAmountMinor);
  const targetReversalAmountMinor = releasedRefundReversalAmountMinor({
    grossAmountMinor: Number(ledger.gross_amount_minor || 0),
    refundedAmountMinor: Number(opts.refundedAmountMinor || 0),
    releasedTransferAmountMinor,
    netAmountMinor: Number(ledger.net_amount_minor || 0),
    alreadyReversedAmountMinor: 0,
  });
  if (targetReversalAmountMinor <= 0) return;

  const plannedAmountMinor = await claimRefundTransferReversal(admin, {
    ledgerId,
    claimKey,
    targetReversalAmountMinor,
  });
  if (plannedAmountMinor <= 0) return;

  const { reversalId, reversalAmountMinor } =
    await createReleasedRefundTransferReversal({
      stripe: getStripeClient() as unknown as TransferReversalStripeClient,
      ledgerId,
      transferId: ledger.transfer_id,
      grossAmountMinor: Number(ledger.gross_amount_minor || 0),
      refundedAmountMinor: Number(opts.refundedAmountMinor || 0),
      releasedTransferAmountMinor,
      netAmountMinor: Number(ledger.net_amount_minor || 0),
      fixedReversalAmountMinor: plannedAmountMinor,
      idempotencyKey: `reversal_${ledgerId}_${claimKey}`,
      metadata: {
        orderId: String(ledger.order_id ?? ""),
        courseId: String(ledger.course_id ?? ""),
        teacherId: String(ledger.teacher_id ?? ""),
        sourceId: opts.sourceId,
        reason: opts.reason,
      },
    });
  if (!reversalId || reversalAmountMinor !== plannedAmountMinor) {
    throw new Error("Stripe refund reversal did not match its reserved claim.");
  }

  await completeRefundTransferReversal(admin, {
    ledgerId,
    claimKey,
    reversalId,
  });
}

// --- charge.refunded (claws back an already-released transfer) --------------
async function handleChargeRefunded(admin: Admin, charge: Stripe.Charge): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentIntentId)
    .maybeSingle();
  if (paymentError) throw new Error(paymentError.message);

  const isFullRefund = charge.refunded === true;
  const refundedStatus = isFullRefund ? "refunded" : "partially_refunded";
  const ts = nowIso();

  if (!payment) {
    // Subscription invoice charge refunded from the Dashboard: no payments doc.
    // Find the subscription payout ledger (paymentId == PI, kind subscription)
    // and mark it refunded. (Transfer clawback is deferred to 2f.)
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
          status: ledgerRefundStatus(isFullRefund, ledger.status),
          refunded_amount_minor: charge.amount_refunded,
          refunded_at: ts,
          updated_at: ts,
        })
        .eq("id", ledger.id),
      "Update subscription refund ledger",
    );
    await reverseReleasedPayout(admin, ledger.id, {
      refundedAmountMinor: charge.amount_refunded,
      sourceId: charge.id,
      reason: "refund",
    });
    // Subscription sales also settle affiliate against the invoice id.
    await clawbackAffiliateCommissionLedger(admin, ledger.id, {
      refundedAmountMinor: charge.amount_refunded,
      saleGrossAmountMinor: charge.amount,
      sourceId: charge.id,
      isFullRefund,
    });
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
  const nextLedgerStatus = ledgerRefundStatus(isFullRefund, ledger?.status);

  await requireSupabaseWrite(
    admin
      .from("payments")
      .update({
        status: refundedStatus,
        refunded_amount_minor: charge.amount_refunded,
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
        refunded_amount_minor: charge.amount_refunded,
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
        refunded_amount_minor: charge.amount_refunded,
        refunded_at: ts,
        updated_at: ts,
      })
      .eq("id", orderId),
    "Update refunded payout ledger",
  );

  await reverseReleasedPayout(admin, orderId, {
    refundedAmountMinor: charge.amount_refunded,
    sourceId: charge.id,
    reason: "refund",
  });

  // Affiliate commission is a separate ledger row (`{orderId}__aff`). On refund
  // we must claw it back too — otherwise Aviator-style money glitch: affiliate
  // keeps commission while buyer is refunded.
  await clawbackAffiliateCommissionLedger(admin, orderId, {
    refundedAmountMinor: charge.amount_refunded,
    saleGrossAmountMinor: charge.amount,
    sourceId: charge.id,
    isFullRefund,
  });

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
// A dispute debits the platform immediately. Without this the release cron would
// still pay the teacher for money the platform no longer holds — a fraud vector.
async function resolveLedgerForDispute(
  admin: Admin,
  dispute: Stripe.Dispute,
): Promise<{ id: string; status: string; transfer_id: string | null } | null> {
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!paymentIntentId) return null;
  const { data, error } = await admin
    .from("payout_ledger")
    .select("id,status,transfer_id")
    .eq("payment_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; status: string; transfer_id: string | null } | null) ?? null;
}

async function handleDisputeCreated(admin: Admin, dispute: Stripe.Dispute): Promise<void> {
  const ledger = await resolveLedgerForDispute(admin, dispute);
  if (!ledger) return;
  const next = nextLedgerStatusOnDispute({
    event: "created",
    currentStatus: ledger.status,
    hasTransfer: Boolean(ledger.transfer_id),
  });
  if (!next) return;
  await requireSupabaseWrite(
    admin
      .from("payout_ledger")
      .update({ status: next, updated_at: nowIso() })
      .eq("id", ledger.id),
    "Mark payout disputed",
  );
  // Payout already left the platform: claw the transfer back, the dispute took
  // the same money from us. reverseReleasedPayout keys on transfer_id, so the
  // status flip above does not block it.
  if (ledger.transfer_id) {
    await reverseReleasedPayout(admin, ledger.id, {
      refundedAmountMinor: dispute.amount,
      sourceId: dispute.id,
      reason: "dispute",
    });
  }
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
    hasTransfer: Boolean(ledger.transfer_id),
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

  const entitled = subscription.status === "active" || subscription.status === "trialing";
  await requireSupabaseWrite(
    admin
      .from("users")
      .update({ current_plan_id: entitled ? planId : "free", updated_at: ts })
      .eq("uid", uid),
    "Update subscriber plan",
  );
}

async function handleInvoicePaymentFailed(
  admin: Admin,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const ts = nowIso();

  let subscription: Stripe.Subscription | null = null;
  try {
    subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
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
        await handleInvoicePaymentFailed(admin, event.data.object);
        break;
      case "invoice.paid":
        await handleCourseSubscriptionInvoicePaid(admin, event.data.object);
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

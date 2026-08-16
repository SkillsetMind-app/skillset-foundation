export type SkillsetPlanId = "free" | "starter" | "pro" | "plus";

export const automaticRefundWindowDays = 7;
export const automaticRefundProgressCap = 50;

export const DEFAULT_PLATFORM_FEE_BPS = 1000;
const PLAN_PLATFORM_FEE_BPS: Record<SkillsetPlanId, number> = {
  free: 1000,
  starter: 500,
  pro: 300,
  plus: 200,
};

const USD_PERCENT_BPS = 290;
const INTERNATIONAL_WITH_CONVERSION_PERCENT_BPS = 540;
const FIXED_FEE_MINOR = 30;

export function canonicalPlatformFeeBpsForPlan(
  planId?: string | null,
): number {
  if (
    planId === "free" ||
    planId === "starter" ||
    planId === "pro" ||
    planId === "plus"
  ) {
    return PLAN_PLATFORM_FEE_BPS[planId];
  }

  return DEFAULT_PLATFORM_FEE_BPS;
}

export function stripeProcessingFeeMinor(
  grossMinor: number,
  currency?: string | null,
) {
  const isUsd = (currency || "").toUpperCase() === "USD";
  const percentBps = isUsd
    ? USD_PERCENT_BPS
    : INTERNATIONAL_WITH_CONVERSION_PERCENT_BPS;
  return Math.round((grossMinor * percentBps) / 10000) + FIXED_FEE_MINOR;
}

// The estimate above is a US-shaped guess. When Stripe hands us the charge's
// balance transaction it states the fee it ACTUALLY took, so prefer that: the
// resulting net is what the teacher's wallet shows as "you earned", and a
// Brazilian or Caribbean teacher on local rates would otherwise see a number
// that disagrees with their own Stripe dashboard. Null = use the estimate.
//
// Returns STRIPE's smallest unit, like every other value read off Stripe — the
// caller runs it through fromStripeAmount() at the same boundary as the rest.
export function stripeFeeMinorFromBalanceTransaction(
  balanceTransaction:
    | {
        currency?: string | null;
        fee?: number | null;
        fee_details?:
          | readonly { type?: string | null; amount?: number | null }[]
          | null;
      }
    | null
    | undefined,
  chargeCurrency: string,
): number | null {
  if (!balanceTransaction) return null;
  // A balance transaction is denominated in the account's SETTLEMENT currency,
  // which can differ from the charge currency. Subtracting a BRL fee from a USD
  // gross would be worse than the estimate, so only trust it when they agree.
  const btCurrency = String(balanceTransaction.currency || "").toUpperCase();
  if (!btCurrency || btCurrency !== chargeCurrency.toUpperCase()) return null;

  const fee = Number(balanceTransaction.fee ?? NaN);
  if (!Number.isFinite(fee)) return null;

  // `fee` is everything Stripe took: processing fee, tax on that fee, AND our
  // application fee. Our commission is computed separately from
  // platform_fee_bps, so subtract it back out or the teacher is charged twice.
  const applicationFee = (balanceTransaction.fee_details || [])
    .filter((detail) => detail?.type === "application_fee")
    .reduce((sum, detail) => sum + Number(detail?.amount || 0), 0);

  return Math.max(0, fee - applicationFee);
}

export type StripeSecretResult =
  | { ok: true; key: string }
  | { ok: false; reason: "missing" | "malformed" };

/**
 * Sanitize a Stripe secret key read from a secret store / env var.
 *
 * Secrets set via the CLI or pasted into a console routinely carry a trailing
 * newline or stray whitespace. Node's http.setHeader rejects ANY control
 * character in a header value, so an untrimmed key makes EVERY Stripe call die
 * with `TypeError [ERR_INVALID_CHAR]: Invalid character in header content
 * ["Authorization"]` — which only ever reaches the caller as an opaque INTERNAL
 * 500 (this exact footgun broke live teacher Stripe onboarding, 2026-06-07).
 *
 * Returns the trimmed key when usable, or a reason the caller maps to a legible
 * error:
 *   - "missing":   no value configured at all.
 *   - "malformed": after trimming, the key still contains a space or a
 *                  non-printable-ASCII char (interior corruption a trim cannot
 *                  fix) — the secret must be re-set as a single clean line.
 */
export function sanitizeStripeSecret(
  raw: string | null | undefined,
): StripeSecretResult {
  if (!raw) {
    return { ok: false, reason: "missing" };
  }

  const key = raw.trim();

  // A whitespace-only value trims to nothing — effectively no key configured.
  if (!key) {
    return { ok: false, reason: "missing" };
  }

  // A valid Stripe key is printable ASCII (0x21-0x7e) with no interior spaces;
  // anything else is interior corruption a trim cannot fix.
  if (/[^\x21-\x7e]/.test(key)) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, key };
}

/**
 * Minimal structural view of a Stripe Invoice for PaymentIntent resolution.
 * Kept dependency-free (no `stripe` import) so this stays pure and unit-testable;
 * the real Stripe.Invoice satisfies it structurally.
 */
export type InvoicePaymentIntentSource = {
  payments?: {
    data?: Array<{
      payment?: { payment_intent?: string | { id: string } | null } | null;
    }>;
  } | null;
  payment_intent?: string | { id: string } | null;
};

/**
 * Resolve the PaymentIntent id backing a paid Stripe Invoice across API versions.
 *
 * The pinned API (2026-02-25.clover, post-Basil) REMOVED the top-level
 * `invoice.payment_intent` field; the PaymentIntent now lives in
 * `invoice.payments.data[].payment.payment_intent`. Reading the old top-level
 * field returns undefined, so a caller that fell back to the invoice id stored a
 * NON-PaymentIntent join key on the payout ledger — which the subscription
 * refund clawback (it matches `payoutLedger.paymentId` against a charge's real
 * `payment_intent`) can never match, silently stranding every dashboard-refunded
 * subscription payout. Read the Basil location first, then the legacy top-level
 * field; return null when neither is present so the caller can retrieve-with
 * -expansion or fall back explicitly.
 */
export function resolveInvoicePaymentIntentId(
  invoice: InvoicePaymentIntentSource,
): string | null {
  for (const entry of invoice.payments?.data ?? []) {
    const pi = entry?.payment?.payment_intent;
    if (typeof pi === "string" && pi) {
      return pi;
    }
    if (pi && typeof pi === "object" && typeof pi.id === "string" && pi.id) {
      return pi.id;
    }
  }

  const legacyField = invoice.payment_intent;
  if (typeof legacyField === "string" && legacyField) {
    return legacyField;
  }
  if (
    legacyField &&
    typeof legacyField === "object" &&
    typeof legacyField.id === "string" &&
    legacyField.id
  ) {
    return legacyField.id;
  }

  return null;
}

/**
 * Status to write to the earnings ledger when a refund lands.
 *
 * Under direct charges the platform never holds the money, so there is nothing
 * to release, reduce or claw back — Stripe debits the refund straight from the
 * teacher's own balance. The status is purely a record of what happened:
 * "refunded" for a full refund, "partially_refunded" otherwise.
 */
export function ledgerRefundStatus(
  isFullRefund: boolean,
): "refunded" | "partially_refunded" {
  return isFullRefund ? "refunded" : "partially_refunded";
}

/**
 * Whether an existing enrollment should be re-activated when a new payment
 * grants access. True for any non-live status (refunded/revoked/expired) so a
 * learner who repurchases after a refund gets access back; false for
 * active/completed so a webhook redelivery never resets progress. A missing
 * enrollment is inserted by the caller, not passed here.
 */
export function shouldReactivateEnrollment(
  status: string | null | undefined,
): boolean {
  return !["active", "completed"].includes(String(status));
}

export function isRefundableEnrollmentSource(
  source: string | null | undefined,
): boolean {
  return source === "payment" || source === "subscription";
}

export function shouldMarkEnrollmentRefundedAfterChargeRefund(input: {
  isFullRefund: boolean;
  ledgerKind: string | null | undefined;
}): boolean {
  return input.isFullRefund && input.ledgerKind !== "course_subscription";
}

export function shouldCancelCourseSubscriptionForRefund(input: {
  isFullRefund: boolean;
  ledgerKind: string | null | undefined;
  subscriptionId: string | null | undefined;
}): boolean {
  return (
    input.isFullRefund
    && input.ledgerKind === "course_subscription"
    && Boolean(input.subscriptionId)
  );
}

/**
 * Next earnings-ledger status when a card dispute (chargeback) moves. Returns
 * null for "no change".
 *
 * Under direct charges the teacher is the merchant of record: Stripe freezes and
 * (if lost) debits the disputed amount from the TEACHER's balance, not ours. So
 * this only records the outcome — there is no transfer to claw back and no
 * release to re-arm.
 *
 * - created: settled earnings become "disputed" (frozen by Stripe).
 * - won:     the teacher kept the money -> back to "settled".
 * - lost:    the money is gone -> "refunded" (terminal).
 */
export function nextLedgerStatusOnDispute(input: {
  event: "created" | "won" | "lost";
  currentStatus: string | null | undefined;
}): "disputed" | "settled" | "refunded" | null {
  const status = String(input.currentStatus);
  if (input.event === "created") {
    return status === "settled" ? "disputed" : null;
  }
  if (input.event === "won") {
    return status === "disputed" ? "settled" : null;
  }
  // lost
  return status === "disputed" ? "refunded" : null;
}

export function paidOrderRefundQuerySpec(userId: string, courseId: string) {
  return {
    filters: [
      ["userId", "==", userId],
      ["courseId", "==", courseId],
      ["status", "==", "paid"],
    ] as const,
    limit: 1,
  };
}

/* ---------------------------------------------------------------------- *
 *  Order status transitions — never clobber a settled money outcome [B2]
 *
 *  checkout.session.expired and payment_intent.payment_failed mark an order
 *  failed/cancelled. Stripe does NOT guarantee event delivery order, so a late
 *  expired/failed event for an earlier attempt can arrive AFTER the successful
 *  checkout.session.completed already marked the order paid. Applying it
 *  unconditionally would revoke a real purchase. These terminal statuses are
 *  therefore frozen against failed/cancelled overwrites.
 * ---------------------------------------------------------------------- */

export const TERMINAL_ORDER_STATUSES = [
  "paid",
  "refunded",
  "partially_refunded",
] as const;

/**
 * Whether a `failed`/`cancelled` transition may be applied to an order whose
 * current status is `currentStatus`. False for the settled money states above
 * (so they are never overwritten); true otherwise (pending/failed/cancelled or
 * an absent status, where setting the terminal-failure state is safe).
 */
export function shouldApplyOrderStatusTransition(
  currentStatus: string | null | undefined,
): boolean {
  if (!currentStatus) {
    return true;
  }
  return !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(currentStatus);
}

/* ---------------------------------------------------------------------- *
 *  In-flight checkout lock — one charge per buyer+course at a time [B3]
 *
 *  createCheckoutSession reads enrollment outside a transaction and then opens
 *  a fresh order + Stripe session. Two concurrent submits (double-click / two
 *  tabs) both pass and both charge. A lock row keyed by `${userId}__${courseId}`
 *  is claimed atomically (the claim_checkout_lock RPC); this decides what a
 *  request that loses the claim should do with the existing lock.
 * ---------------------------------------------------------------------- */

export type CheckoutLockSnapshot = {
  /** Server time the lock was claimed, in epoch ms; null when unknown. */
  claimedAtMs: number | null;
  /** Live Stripe Checkout url published by the winning request, if any. */
  checkoutUrl: string | null;
};

export type CheckoutLockDecision = "reuse" | "wait" | "takeover";

export type CheckoutLockWindows = {
  /** How long a published session url is assumed live (>= Stripe session TTL). */
  sessionTtlMs: number;
  /** Grace for a claim that has not published a url yet (one Stripe call). */
  claimGraceMs: number;
};

/**
 * Decide what a checkout request does when an in-flight lock for the same
 * user+course already exists:
 *  - "reuse":    the lock carries a still-live session url -> hand back the
 *                SAME url so no second charge is ever opened.
 *  - "wait":     a sibling just claimed the lock but has not published a url yet
 *                (still mid Stripe call, within claimGrace) -> retry shortly.
 *  - "takeover": no lock; OR a url-bearing lock whose session has aged out; OR a
 *                url-less claim older than claimGrace (the prior attempt died) ->
 *                safe to claim and proceed. The short claimGrace is what stops a
 *                transient failure from freezing the buyer for the full TTL.
 */
export function decideCheckoutLock(
  lock: CheckoutLockSnapshot | null,
  nowMs: number,
  windows: CheckoutLockWindows,
): CheckoutLockDecision {
  if (!lock || lock.claimedAtMs == null) {
    return "takeover";
  }
  const ageMs = nowMs - lock.claimedAtMs;
  if (lock.checkoutUrl) {
    return ageMs < windows.sessionTtlMs ? "reuse" : "takeover";
  }
  return ageMs < windows.claimGraceMs ? "wait" : "takeover";
}

/**
 * Whether a terminal order event may release the buyer+course checkout lock.
 *
 * The lock is keyed by `${userId}__${courseId}`, but one buyer accrues many
 * order attempts over time that all share that single lock doc. A late
 * expired/failed event for an OLD attempt must NOT delete the lock a LIVE
 * re-purchase just claimed — doing so re-opens the double-charge window the
 * lock exists to close. The lock records the `orderId` of the attempt that owns
 * it, so we release only when the event's order is that owner. An unset/non
 * -string owner (a claim that has not published yet) never matches → never
 * released, leaving it to its own TTL self-heal.
 */
export function shouldReleaseCheckoutLock(
  lockOrderId: unknown,
  currentOrderId: string,
): boolean {
  return typeof lockOrderId === "string" && lockOrderId === currentOrderId;
}

export type SkillsetPlanId = "free" | "starter" | "pro" | "plus";

export const payoutReleaseDelayDayOptions = [7, 10, 15, 30] as const;
export type PayoutReleaseDelayDays = (typeof payoutReleaseDelayDayOptions)[number];

/**
 * Default payout clearance window in days. Founder-selected at 30: the teacher
 * payout is held 30 days, comfortably past the 7-day student refund window
 * below, so cleared payouts never predate a still-refundable charge. Selectable
 * among `payoutReleaseDelayDayOptions`; every option is >= the refund window.
 */
export const payoutReleaseDelayDays: PayoutReleaseDelayDays = 30;

/** Coerce an arbitrary stored config value to a supported payout delay. */
export function resolvePayoutReleaseDelayDays(
  value: unknown,
): PayoutReleaseDelayDays {
  if (
    typeof value === "number" &&
    (payoutReleaseDelayDayOptions as readonly number[]).includes(value)
  ) {
    return value as PayoutReleaseDelayDays;
  }
  return payoutReleaseDelayDays;
}

export const automaticRefundWindowDays = 7;
export const automaticRefundProgressCap = 50;

export const DEFAULT_PLATFORM_FEE_BPS = 800;
const PLAN_PLATFORM_FEE_BPS: Record<SkillsetPlanId, number> = {
  free: 800,
  starter: 400,
  pro: 100,
  plus: 0,
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

export function releasedRefundReversalAmountMinor(input: {
  grossAmountMinor: number;
  refundedAmountMinor: number;
  releasedTransferAmountMinor: number;
  /**
   * Original full net (gross - fees) for this payout. Only meaningful when a
   * partial refund BEFORE release already shrank the transfer below the full
   * net. Omit (or pass null) for the common case where the full net was
   * transferred — the reversal then uses the proven proportional-on-transferred
   * formula, unchanged.
   */
  netAmountMinor?: number | null;
  alreadyReversedAmountMinor?: number | null;
}): number {
  const gross = Math.max(0, Math.floor(input.grossAmountMinor));
  const refunded = Math.max(0, Math.floor(input.refundedAmountMinor));
  const transferred = Math.max(0, Math.floor(input.releasedTransferAmountMinor));
  const alreadyReversed = Math.max(
    0,
    Math.floor(input.alreadyReversedAmountMinor ?? 0),
  );

  if (gross <= 0 || refunded <= 0 || transferred <= 0) {
    return 0;
  }

  const cappedRefunded = Math.min(refunded, gross);
  const net =
    input.netAmountMinor == null
      ? null
      : Math.max(0, Math.floor(input.netAmountMinor));

  let targetReversal: number;
  if (net != null && transferred < net) {
    // A partial refund before release already reduced the transfer below the
    // full net. The teacher keeps the proportional entitlement on the ORIGINAL
    // net — net * (gross - refunded) / gross — so reverse only the difference
    // between what was transferred and that entitlement. Without this branch,
    // a SECOND refund after such a reduced release would over-claw the teacher.
    const netAfterRefund = Math.max(
      0,
      Math.floor((net * (gross - cappedRefunded)) / gross),
    );
    targetReversal = Math.max(0, transferred - netAfterRefund);
  } else {
    // Full net was transferred (or net unknown): proven proportional reversal
    // on the transferred amount. Bit-for-bit the prior behavior.
    targetReversal = Math.min(
      transferred,
      Math.floor((transferred * cappedRefunded) / gross),
    );
  }

  return Math.max(0, targetReversal - alreadyReversed);
}

/**
 * Amount to actually transfer to the teacher when a payout is released.
 *
 * The common case (no refund before release) pays the full net. When a partial
 * refund landed BEFORE the payout cleared, the teacher is only entitled to the
 * proportional share of the original net on the un-refunded portion:
 *   floor(net * (gross - refunded) / gross)
 * A full refund before release collapses this to 0 (nothing is transferred).
 *
 * Computed once at claim time and frozen on the ledger (plannedTransferAmountMinor)
 * so retries of the same release move an identical amount under a stable Stripe
 * idempotency key — never recomputed mid-flight, which would risk an
 * idempotency-key-reuse-with-different-params error or a double transfer.
 */
export function plannedReleaseTransferAmountMinor(input: {
  netAmountMinor: number;
  grossAmountMinor: number;
  refundedAmountMinor?: number | null;
}): number {
  const net = Math.max(0, Math.floor(input.netAmountMinor));
  const refunded = Math.max(0, Math.floor(input.refundedAmountMinor ?? 0));

  // No pre-release refund recorded -> the full net is owed.
  if (refunded <= 0) {
    return net;
  }

  const gross = Math.max(0, Math.floor(input.grossAmountMinor));
  if (gross <= 0) {
    return net;
  }

  const cappedRefunded = Math.min(refunded, gross);
  return Math.max(0, Math.floor((net * (gross - cappedRefunded)) / gross));
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
 * Status to write to a payout ledger when a refund lands, given the refund's
 * scope and the ledger's CURRENT (transactionally read) status.
 *
 *  - full refund            -> "refunded" (terminal).
 *  - partial, still queued  -> "in_release": the payout has not been claimed by
 *                              the release cron yet, so keep it releasable and
 *                              let the cron move the REDUCED transfer
 *                              (plannedReleaseTransferAmountMinor) instead of
 *                              stranding the teacher's payout. (Gap 1)
 *  - partial, anything else -> "partially_refunded": the payout is releasing/
 *                              released (the reversal path handles the clawback)
 *                              or already refunded.
 *
 * Keying off the FRESH status is what stops a refund that races the cron from
 * flipping an already-`released` ledger back to `in_release` and double-paying.
 */
export function ledgerRefundStatus(
  isFullRefund: boolean,
  currentLedgerStatus: string | null | undefined,
): "refunded" | "partially_refunded" | "in_release" {
  if (isFullRefund) {
    return "refunded";
  }
  return currentLedgerStatus === "in_release"
    ? "in_release"
    : "partially_refunded";
}

/**
 * Whether a refund should reverse an already-released payout transfer. True when
 * the payout actually left the platform: a transferId was recorded and a
 * positive amount was transferred. We key on the transfer (immutable evidence
 * the money moved), NOT on status === "released" — the refund handler overwrites
 * the ledger status to refunded/partially_refunded BEFORE this gate runs, so a
 * status check would always be false and the clawback would never fire. A
 * still-held (in_release/releasing) payout has no transferId yet, so this
 * returns false and the refund simply reduces what the release cron will move.
 */
export function shouldReverseReleasedPayout(input: {
  transferId: string | null | undefined;
  releasedTransferAmountMinor: number;
}): boolean {
  return Boolean(input.transferId) && input.releasedTransferAmountMinor > 0;
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

/**
 * Next payout-ledger status when a card dispute (chargeback) moves. Returns null
 * for "no change".
 *
 * - created: Stripe has debited the platform and the funds are frozen. Freeze
 *   any payout that could still pay the teacher — held (in_release/releasing) or
 *   already transferred (released; the caller also claws the transfer back).
 * - won: the platform kept the money. Re-arm a still-frozen, not-yet-transferred
 *   payout so the release cron can move it. A payout already transferred was
 *   clawed back on `created`; re-releasing it is unsafe, so leave it for a human.
 * - lost: the money is gone for good. A frozen payout must never release, so
 *   mark it refunded (terminal); a transfer already clawed back on `created`
 *   needs nothing more.
 */
export function nextLedgerStatusOnDispute(input: {
  event: "created" | "won" | "lost";
  currentStatus: string | null | undefined;
  hasTransfer: boolean;
}): "disputed" | "in_release" | "refunded" | null {
  const status = String(input.currentStatus);
  if (input.event === "created") {
    return ["in_release", "releasing", "released"].includes(status)
      ? "disputed"
      : null;
  }
  if (input.event === "won") {
    return status === "disputed" && !input.hasTransfer ? "in_release" : null;
  }
  // lost
  return status === "disputed" ? "refunded" : null;
}

export type TransferReversalStripeClient = {
  transfers: {
    createReversal: (
      transferId: string,
      params: {
        amount: number;
        metadata: Record<string, string>;
      },
      options: { idempotencyKey: string },
    ) => Promise<{ id: string }>;
  };
};

export async function createReleasedRefundTransferReversal(input: {
  stripe: TransferReversalStripeClient;
  ledgerId: string;
  transferId?: string | null;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  releasedTransferAmountMinor: number;
  /**
   * Original full net for this payout. Forwarded so the reversal math can tell
   * a partial-refund-before-release reduced transfer apart from a full-net
   * transfer (see releasedRefundReversalAmountMinor). Omit/null when the full
   * net was transferred — the proven proportional-on-transferred path is used.
   */
  netAmountMinor?: number | null;
  alreadyReversedAmountMinor?: number | null;
  /**
   * When set, reverse EXACTLY this amount instead of recomputing — used by the
   * claim/reserve flow, where the amount was planned transactionally against
   * the fresh ledger and must not drift between the reservation and the Stripe
   * call (the Stripe idempotency key is bound to a single amount).
   */
  fixedReversalAmountMinor?: number | null;
  idempotencyKey: string;
  metadata: Record<string, string>;
}): Promise<{
  reversalId: string | null;
  reversalAmountMinor: number;
}> {
  if (!input.transferId) {
    return { reversalId: null, reversalAmountMinor: 0 };
  }

  const reversalAmountMinor =
    input.fixedReversalAmountMinor != null
      ? Math.max(0, Math.floor(input.fixedReversalAmountMinor))
      : releasedRefundReversalAmountMinor({
          grossAmountMinor: input.grossAmountMinor,
          refundedAmountMinor: input.refundedAmountMinor,
          releasedTransferAmountMinor: input.releasedTransferAmountMinor,
          netAmountMinor: input.netAmountMinor,
          alreadyReversedAmountMinor: input.alreadyReversedAmountMinor,
        });

  if (reversalAmountMinor <= 0) {
    return { reversalId: null, reversalAmountMinor: 0 };
  }

  const reversal = await input.stripe.transfers.createReversal(
    input.transferId,
    {
      amount: reversalAmountMinor,
      metadata: {
        ledgerId: input.ledgerId,
        ...input.metadata,
      },
    },
    {
      idempotencyKey: input.idempotencyKey,
    },
  );

  return {
    reversalId: reversal.id,
    reversalAmountMinor,
  };
}

/* ---------------------------------------------------------------------- *
 *  Refund-reversal claims — serialize concurrent charge.refunded deliveries
 *
 *  Two DISTINCT charge.refunded events (e.g. two partial refunds issued
 *  seconds apart) can be processed concurrently: the event-level idempotency
 *  gate only dedupes the SAME event id. Both handlers would then read a stale
 *  transferReversedAmountMinor and each plan a reversal against the same
 *  un-reversed balance — over-clawing the teacher (Stripe only caps the total
 *  at the full transfer amount, not at the correct proportional figure).
 *
 *  Fix mirrors the webhook's two-phase claim, scoped to the ledger doc:
 *  Phase 1 claims this delivery's key (chargeId + CUMULATIVE amount_refunded)
 *  and reserves the planned amount inside a transaction, planning against the
 *  fresh reversed counter PLUS any other in-flight reservations. Phase 2 (after
 *  the Stripe call) promotes the claim to "done" and folds the executed amount
 *  into transferReversedAmountMinor, guarded on the claim still being
 *  "pending" so a double delivery can never double-count.
 *
 *  Crash safety: a claim stuck "pending" re-executes on the webhook retry with
 *  the SAME planned amount and the SAME Stripe idempotency key, so Stripe
 *  replays — not repeats — the reversal.
 * ---------------------------------------------------------------------- */

export type RefundReversalClaimState = "pending" | "done";

export type RefundReversalClaimRecord = {
  state: RefundReversalClaimState;
  plannedAmountMinor: number;
};

export type RefundReversalClaimDecision = {
  action: "skip" | "execute";
  plannedAmountMinor: number;
};

/**
 * Ledger-map key for one charge.refunded delivery. amount_refunded is
 * CUMULATIVE on the charge, so (chargeId, amount) uniquely identifies a refund
 * state — a pure redelivery reuses the key and is absorbed by the claim.
 */
export function refundReversalClaimKey(
  chargeId: string,
  cumulativeRefundedAmountMinor: number,
): string {
  return `${chargeId}_${Math.max(0, Math.floor(cumulativeRefundedAmountMinor))}`;
}

/**
 * Phase-1 decision for a charge.refunded delivery, evaluated against the
 * TRANSACTIONALLY-FRESH ledger state:
 *  - claim already "done"    -> skip (this cumulative amount was fully
 *    accounted; this is a Stripe redelivery).
 *  - claim still "pending"   -> execute the ORIGINALLY planned amount (a prior
 *    attempt died between phases; the stable Stripe idempotency key makes the
 *    re-issued call a replay, not a repeat).
 *  - no claim                -> plan fresh, counting other pending claims'
 *    reservations as already-reversed so concurrent deliveries never plan
 *    against the same un-reversed balance.
 */
export function decideRefundReversalClaim(input: {
  existingClaim: RefundReversalClaimRecord | null | undefined;
  otherPendingReservedMinor: number;
  shouldReverse: boolean;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  releasedTransferAmountMinor: number;
  netAmountMinor?: number | null;
  alreadyReversedAmountMinor: number;
}): RefundReversalClaimDecision {
  if (input.existingClaim?.state === "done") {
    return { action: "skip", plannedAmountMinor: 0 };
  }

  if (input.existingClaim?.state === "pending") {
    const planned = Math.max(
      0,
      Math.floor(Number(input.existingClaim.plannedAmountMinor || 0)),
    );
    return planned > 0
      ? { action: "execute", plannedAmountMinor: planned }
      : { action: "skip", plannedAmountMinor: 0 };
  }

  if (!input.shouldReverse) {
    return { action: "skip", plannedAmountMinor: 0 };
  }

  const planned = releasedRefundReversalAmountMinor({
    grossAmountMinor: input.grossAmountMinor,
    refundedAmountMinor: input.refundedAmountMinor,
    releasedTransferAmountMinor: input.releasedTransferAmountMinor,
    netAmountMinor: input.netAmountMinor,
    alreadyReversedAmountMinor:
      Math.max(0, Math.floor(input.alreadyReversedAmountMinor))
      + Math.max(0, Math.floor(input.otherPendingReservedMinor)),
  });

  return planned > 0
    ? { action: "execute", plannedAmountMinor: planned }
    : { action: "skip", plannedAmountMinor: 0 };
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
 *  Stripe webhook idempotency — two-phase claim / complete
 *
 *  Stripe redelivers an event on ANY non-2xx response. A single-phase
 *  "claim-before-commit" marker (write the processed-doc, THEN run the
 *  handler) silently loses events: a transient handler failure returns 500,
 *  Stripe retries, but the marker already exists so the retry short-circuits
 *  as a duplicate and the handler NEVER re-runs — the enrollment/payout is
 *  lost forever.
 *
 *  Two-phase fix: claim the marker as "processing", and promote it to "done"
 *  only AFTER the handler succeeds. We short-circuit ONLY on "done". A marker
 *  stuck at "processing" means a prior attempt died mid-flight (a handler
 *  throw, or a hard crash between claim and completion), so we reprocess.
 *  Every webhook handler is idempotent — writes are merge/update, the
 *  enrollment write is existence-guarded, and the one money movement (the
 *  released-transfer reversal) carries a stable Stripe idempotencyKey — so
 *  reprocessing a "processing" marker never double-charges, double-pays, or
 *  double-enrolls.
 * ---------------------------------------------------------------------- */

export type StripeEventMarkerStatus = "processing" | "done";
export type StripeEventClaimDecision = "process" | "duplicate";

/** Minimal Firestore DocumentReference surface used by the idempotency gate. */
export type StripeEventMarkerRef = {
  /** Mirrors Firestore `.create()`: rejects if the document already exists. */
  create: (data: Record<string, unknown>) => Promise<unknown>;
  get: () => Promise<{
    exists: boolean;
    data: () => { status?: string } | undefined;
  }>;
  set: (
    data: Record<string, unknown>,
    options: { merge: true },
  ) => Promise<unknown>;
};

/**
 * Decide whether to (re)process a Stripe event given its marker status.
 * Short-circuits ONLY when a prior attempt completed ("done"); an absent or
 * still-"processing" marker means the event has not been fully handled yet.
 */
export function decideStripeEventClaim(
  status: StripeEventMarkerStatus | null | undefined,
): StripeEventClaimDecision {
  return status === "done" ? "duplicate" : "process";
}

/**
 * Phase 1 — claim the event. Tries to create the marker as "processing". If
 * the marker already exists, reads its status and defers to
 * decideStripeEventClaim, so a stale "processing" marker is reprocessed and a
 * "done" marker is acknowledged as a duplicate. `stamp` returns the value
 * written to `claimedAt` (a Firestore server-timestamp sentinel in prod).
 */
export async function claimStripeEvent(
  ref: StripeEventMarkerRef,
  stamp: () => unknown,
): Promise<StripeEventClaimDecision> {
  try {
    await ref.create({ status: "processing", claimedAt: stamp() });
    return "process";
  } catch {
    const snapshot = await ref.get();
    const status = snapshot.exists ? snapshot.data()?.status : undefined;
    return decideStripeEventClaim(
      status === "done" || status === "processing" ? status : null,
    );
  }
}

/** Phase 2 — promote the marker to "done" after the handler succeeds. */
export async function markStripeEventDone(
  ref: StripeEventMarkerRef,
  stamp: () => unknown,
): Promise<void> {
  await ref.set({ status: "done", processedAt: stamp() }, { merge: true });
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
 *  tabs) both pass and both charge. A lock doc keyed by `${userId}__${courseId}`
 *  is claimed atomically (Firestore .create); this decides what a request that
 *  loses the claim should do with the existing lock.
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

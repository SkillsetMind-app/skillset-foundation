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

const DEFAULT_PLATFORM_FEE_BPS = 800;
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

export function releasedRefundReversalAmountMinor(input: {
  grossAmountMinor: number;
  refundedAmountMinor: number;
  releasedTransferAmountMinor: number;
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

  const targetReversal = Math.min(
    transferred,
    Math.floor((transferred * Math.min(refunded, gross)) / gross),
  );

  return Math.max(0, targetReversal - alreadyReversed);
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
  alreadyReversedAmountMinor?: number | null;
  idempotencyKey: string;
  metadata: Record<string, string>;
}): Promise<{
  reversalId: string | null;
  reversalAmountMinor: number;
}> {
  if (!input.transferId) {
    return { reversalId: null, reversalAmountMinor: 0 };
  }

  const reversalAmountMinor = releasedRefundReversalAmountMinor({
    grossAmountMinor: input.grossAmountMinor,
    refundedAmountMinor: input.refundedAmountMinor,
    releasedTransferAmountMinor: input.releasedTransferAmountMinor,
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

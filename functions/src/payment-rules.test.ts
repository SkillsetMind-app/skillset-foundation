import { describe, expect, it, vi } from "vitest";

import {
  canonicalPlatformFeeBpsForPlan,
  claimStripeEvent,
  createReleasedRefundTransferReversal,
  decideCheckoutLock,
  decideStripeEventClaim,
  markStripeEventDone,
  paidOrderRefundQuerySpec,
  payoutReleaseDelayDays,
  releasedRefundReversalAmountMinor,
  shouldApplyOrderStatusTransition,
  shouldReleaseCheckoutLock,
  stripeProcessingFeeMinor,
  type StripeEventMarkerRef,
} from "./payment-rules";

/**
 * In-memory stand-in for a Firestore DocumentReference that reproduces the two
 * semantics the idempotency gate relies on: `.create()` rejects when the doc
 * already exists, and `.set(..., {merge:true})` shallow-merges onto it.
 */
function makeFakeMarkerRef(): StripeEventMarkerRef {
  let doc: { status?: string } | undefined;
  return {
    create: async (data) => {
      if (doc !== undefined) {
        throw new Error("ALREADY_EXISTS");
      }
      doc = { ...(data as { status?: string }) };
      return undefined;
    },
    get: async () => ({
      exists: doc !== undefined,
      data: () => doc,
    }),
    set: async (data) => {
      doc = { ...(doc ?? {}), ...(data as { status?: string }) };
      return undefined;
    },
  };
}

describe("functions payment rules", () => {
  it("uses a 30 day payout release delay", () => {
    expect(payoutReleaseDelayDays).toBe(30);
  });

  it("keeps plan commission canonical across Free, Starter, Pro, and Plus", () => {
    expect(canonicalPlatformFeeBpsForPlan("free")).toBe(800);
    expect(canonicalPlatformFeeBpsForPlan("starter")).toBe(400);
    expect(canonicalPlatformFeeBpsForPlan("pro")).toBe(100);
    expect(canonicalPlatformFeeBpsForPlan("plus")).toBe(0);
    expect(canonicalPlatformFeeBpsForPlan("unknown")).toBe(800);
  });

  it("estimates non-USD Stripe processing at 5.4% plus fixed fee", () => {
    expect(stripeProcessingFeeMinor(10000, "USD")).toBe(320);
    expect(stripeProcessingFeeMinor(10000, "EUR")).toBe(570);
    expect(stripeProcessingFeeMinor(10000, "brl")).toBe(570);
  });

  it("looks up refund orders by user, course, and paid status directly", () => {
    expect(paidOrderRefundQuerySpec("user_1", "course_1")).toEqual({
      filters: [
        ["userId", "==", "user_1"],
        ["courseId", "==", "course_1"],
        ["status", "==", "paid"],
      ],
      limit: 1,
    });
  });

  it("calculates a proportional reversal after a released transfer", () => {
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 2500,
        releasedTransferAmountMinor: 8880,
        alreadyReversedAmountMinor: 0,
      }),
    ).toBe(2220);

    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 10000,
        releasedTransferAmountMinor: 8880,
        alreadyReversedAmountMinor: 2220,
      }),
    ).toBe(6660);
  });

  it("creates a Stripe transfer reversal for refund amounts after payout release", async () => {
    const createReversal = vi.fn().mockResolvedValue({ id: "trr_123" });
    const result = await createReleasedRefundTransferReversal({
      stripe: {
        transfers: {
          createReversal,
        },
      },
      ledgerId: "order_123",
      transferId: "tr_123",
      grossAmountMinor: 10000,
      refundedAmountMinor: 2500,
      releasedTransferAmountMinor: 8880,
      alreadyReversedAmountMinor: 0,
      idempotencyKey: "transfer_reversal_order_123_ch_123_2220",
      metadata: {
        orderId: "order_123",
        paymentId: "pi_123",
      },
    });

    expect(result).toEqual({
      reversalId: "trr_123",
      reversalAmountMinor: 2220,
    });
    expect(createReversal).toHaveBeenCalledWith(
      "tr_123",
      {
        amount: 2220,
        metadata: {
          ledgerId: "order_123",
          orderId: "order_123",
          paymentId: "pi_123",
        },
      },
      {
        idempotencyKey: "transfer_reversal_order_123_ch_123_2220",
      },
    );
  });
});

describe("stripe webhook idempotency (B1)", () => {
  const stamp = () => "ts";

  it("only treats a completed ('done') marker as a duplicate", () => {
    expect(decideStripeEventClaim("done")).toBe("duplicate");
    expect(decideStripeEventClaim("processing")).toBe("process");
    expect(decideStripeEventClaim(null)).toBe("process");
    expect(decideStripeEventClaim(undefined)).toBe("process");
  });

  it("claims an unseen event for processing", async () => {
    const ref = makeFakeMarkerRef();
    expect(await claimStripeEvent(ref, stamp)).toBe("process");
  });

  it("REPROCESSES an event whose prior attempt failed before completion", async () => {
    const ref = makeFakeMarkerRef();
    // First delivery: claimed as "processing", then the handler throws — so it
    // is never promoted to "done".
    expect(await claimStripeEvent(ref, stamp)).toBe("process");
    // Stripe retries the SAME event id. The marker is still "processing", so we
    // MUST reprocess. The old claim-before-commit gate returned a false
    // "duplicate" here and silently dropped the enrollment/payout — this is the
    // exact B1 regression guard.
    expect(await claimStripeEvent(ref, stamp)).toBe("process");
    expect(await claimStripeEvent(ref, stamp)).toBe("process");
  });

  it("short-circuits a redelivered event once it completed", async () => {
    const ref = makeFakeMarkerRef();
    expect(await claimStripeEvent(ref, stamp)).toBe("process");
    await markStripeEventDone(ref, stamp);
    expect(await claimStripeEvent(ref, stamp)).toBe("duplicate");
    // Stays a duplicate on every further redelivery.
    expect(await claimStripeEvent(ref, stamp)).toBe("duplicate");
  });

  it("promotes to done via merge without clobbering the original claim", async () => {
    const ref = makeFakeMarkerRef();
    await claimStripeEvent(ref, () => "claim-ts");
    await markStripeEventDone(ref, () => "done-ts");
    const snapshot = await ref.get();
    expect(snapshot.data()).toMatchObject({
      status: "done",
      claimedAt: "claim-ts",
      processedAt: "done-ts",
    });
  });
});

describe("order status transitions (B2)", () => {
  it("never overwrites a settled money outcome", () => {
    expect(shouldApplyOrderStatusTransition("paid")).toBe(false);
    expect(shouldApplyOrderStatusTransition("refunded")).toBe(false);
    expect(shouldApplyOrderStatusTransition("partially_refunded")).toBe(false);
  });

  it("allows transitions from non-terminal or absent statuses", () => {
    expect(shouldApplyOrderStatusTransition("pending")).toBe(true);
    expect(shouldApplyOrderStatusTransition("failed")).toBe(true);
    expect(shouldApplyOrderStatusTransition("cancelled")).toBe(true);
    expect(shouldApplyOrderStatusTransition("")).toBe(true);
    expect(shouldApplyOrderStatusTransition(null)).toBe(true);
    expect(shouldApplyOrderStatusTransition(undefined)).toBe(true);
  });
});

describe("in-flight checkout lock (B3)", () => {
  const windows = { sessionTtlMs: 35 * 60 * 1000, claimGraceMs: 2 * 60 * 1000 };
  const now = 10_000_000;

  it("takes over when there is no usable lock", () => {
    expect(decideCheckoutLock(null, now, windows)).toBe("takeover");
    expect(
      decideCheckoutLock({ claimedAtMs: null, checkoutUrl: null }, now, windows),
    ).toBe("takeover");
  });

  it("reuses a live session url so a second tab never opens a 2nd charge", () => {
    expect(
      decideCheckoutLock(
        { claimedAtMs: now - 60_000, checkoutUrl: "https://stripe/session" },
        now,
        windows,
      ),
    ).toBe("reuse");
  });

  it("takes over a url-bearing lock whose session has aged out", () => {
    expect(
      decideCheckoutLock(
        {
          claimedAtMs: now - windows.sessionTtlMs - 1,
          checkoutUrl: "https://stripe/session",
        },
        now,
        windows,
      ),
    ).toBe("takeover");
  });

  it("waits for a sibling mid-claim but takes over a dead claim", () => {
    // Inside the grace window, no url yet: a sibling is mid Stripe call -> wait.
    expect(
      decideCheckoutLock(
        { claimedAtMs: now - 1_000, checkoutUrl: null },
        now,
        windows,
      ),
    ).toBe("wait");
    // Past the grace window, still no url: the claiming request died -> takeover,
    // so a transient failure can't freeze the buyer for the full session TTL.
    expect(
      decideCheckoutLock(
        { claimedAtMs: now - windows.claimGraceMs - 1, checkoutUrl: null },
        now,
        windows,
      ),
    ).toBe("takeover");
  });
});

describe("checkout lock release ownership (B3)", () => {
  it("releases only when the lock belongs to the order being marked", () => {
    expect(shouldReleaseCheckoutLock("order_A", "order_A")).toBe(true);
  });

  it("never drops a sibling re-purchase's live lock", () => {
    // The exact wrong-money path the adversarial review caught: a late terminal
    // event for OLD attempt A must not delete LIVE attempt B's lock.
    expect(shouldReleaseCheckoutLock("order_B", "order_A")).toBe(false);
  });

  it("never releases a lock with no recorded owner yet", () => {
    expect(shouldReleaseCheckoutLock(undefined, "order_A")).toBe(false);
    expect(shouldReleaseCheckoutLock(null, "order_A")).toBe(false);
    expect(shouldReleaseCheckoutLock(123, "order_A")).toBe(false);
    expect(shouldReleaseCheckoutLock("", "order_A")).toBe(false);
  });
});

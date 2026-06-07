import { describe, expect, it, vi } from "vitest";

import {
  canonicalPlatformFeeBpsForPlan,
  claimStripeEvent,
  createReleasedRefundTransferReversal,
  decideStripeEventClaim,
  markStripeEventDone,
  paidOrderRefundQuerySpec,
  payoutReleaseDelayDays,
  releasedRefundReversalAmountMinor,
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

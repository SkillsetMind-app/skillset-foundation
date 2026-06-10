import { describe, expect, it, vi } from "vitest";

import {
  canonicalPlatformFeeBpsForPlan,
  claimStripeEvent,
  createReleasedRefundTransferReversal,
  decideCheckoutLock,
  decideRefundReversalClaim,
  decideStripeEventClaim,
  ledgerRefundStatus,
  markStripeEventDone,
  paidOrderRefundQuerySpec,
  payoutReleaseDelayDays,
  plannedReleaseTransferAmountMinor,
  refundReversalClaimKey,
  releasedRefundReversalAmountMinor,
  resolveInvoicePaymentIntentId,
  sanitizeStripeSecret,
  shouldApplyOrderStatusTransition,
  shouldReleaseCheckoutLock,
  shouldReverseReleasedPayout,
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

  it("does not over-claw when a partial refund BEFORE release already shrank the transfer (Gap 1)", () => {
    // Scenario: gross 10000, full net 9170. A 2000 refund arrives BEFORE
    // release, so the cron transfers only the reduced
    // floor(9170 * (10000 - 2000) / 10000) = 7336. THEN a second refund brings
    // the cumulative refund to 3000 (30% of gross) AFTER release.
    //
    // The teacher's true entitlement is net * (gross - refunded) / gross =
    // floor(9170 * 7000 / 10000) = 6419, so only 7336 - 6419 = 917 may be
    // reversed. Passing netAmountMinor unlocks that net-based path.
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 3000,
        releasedTransferAmountMinor: 7336,
        netAmountMinor: 9170,
        alreadyReversedAmountMinor: 0,
      }),
    ).toBe(917);

    // The proven proportional-on-transferred formula (what we get WITHOUT the
    // net) would over-claw: min(7336, floor(7336 * 3000 / 10000)) = 2200, which
    // leaves the teacher 7336 - 2200 = 5136 < their 6419 entitlement. The net
    // branch is what prevents that wrong-money outcome.
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 3000,
        releasedTransferAmountMinor: 7336,
        alreadyReversedAmountMinor: 0,
      }),
    ).toBe(2200);
  });

  it("reverses the full remaining reduced transfer on a later full refund (Gap 1)", () => {
    // Continuing the scenario above: after the 917 reversal, a THIRD refund
    // takes the course to a full 10000 refund. netAfterRefund collapses to 0,
    // so the entire 7336 transfer must come back; netting out the 917 already
    // reversed leaves 6419 to reverse now (917 + 6419 = 7336 total = the whole
    // reduced transfer, so the teacher keeps nothing on a fully refunded sale).
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 10000,
        releasedTransferAmountMinor: 7336,
        netAmountMinor: 9170,
        alreadyReversedAmountMinor: 917,
      }),
    ).toBe(6419);
  });

  it("uses the unchanged proportional path when the full net was transferred (Gap 1 boundary)", () => {
    // When the transfer equals the full net (no pre-release refund), transferred
    // is NOT < net, so the net branch is skipped and the math is bit-for-bit the
    // proven proportional-on-transferred reversal — passing net must NOT alter a
    // full-net payout's reversal.
    const withNet = releasedRefundReversalAmountMinor({
      grossAmountMinor: 10000,
      refundedAmountMinor: 2500,
      releasedTransferAmountMinor: 9170,
      netAmountMinor: 9170,
      alreadyReversedAmountMinor: 0,
    });
    const withoutNet = releasedRefundReversalAmountMinor({
      grossAmountMinor: 10000,
      refundedAmountMinor: 2500,
      releasedTransferAmountMinor: 9170,
      alreadyReversedAmountMinor: 0,
    });
    // min(9170, floor(9170 * 2500 / 10000)) = min(9170, 2292) = 2292.
    expect(withNet).toBe(2292);
    expect(withoutNet).toBe(2292);
  });

  it("plans the full net transfer when no refund landed before release (Gap 1)", () => {
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
        refundedAmountMinor: 0,
      }),
    ).toBe(9170);
    // refundedAmountMinor omitted entirely is treated as zero -> full net.
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
      }),
    ).toBe(9170);
  });

  it("plans a reduced transfer proportional to the un-refunded net (Gap 1)", () => {
    // A 2000 (20%) refund before release -> floor(9170 * 8000 / 10000) = 7336.
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
        refundedAmountMinor: 2000,
      }),
    ).toBe(7336);
    // A 3000 (30%) refund -> floor(9170 * 7000 / 10000) = 6419.
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
        refundedAmountMinor: 3000,
      }),
    ).toBe(6419);
  });

  it("plans zero transfer when fully (or over-) refunded before release (Gap 1)", () => {
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
        refundedAmountMinor: 10000,
      }),
    ).toBe(0);
    // A refund recorded above gross is capped at gross -> still zero, never
    // negative.
    expect(
      plannedReleaseTransferAmountMinor({
        netAmountMinor: 9170,
        grossAmountMinor: 10000,
        refundedAmountMinor: 12000,
      }),
    ).toBe(0);
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

describe("stripe secret sanitization (ERR_INVALID_CHAR onboarding fix)", () => {
  it("trims a trailing newline so the Authorization header is valid", () => {
    // The live regression: STRIPE_SECRET_KEY secret v4 was stored with a
    // trailing "\n", making `Bearer sk_live_xxx\n` throw ERR_INVALID_CHAR on
    // every Stripe call (opaque INTERNAL 500). Trimming must recover the key.
    expect(sanitizeStripeSecret("sk_live_abc123\n")).toEqual({
      ok: true,
      key: "sk_live_abc123",
    });
  });

  it("trims surrounding whitespace and carriage returns", () => {
    expect(sanitizeStripeSecret("  sk_test_abc123  ")).toEqual({
      ok: true,
      key: "sk_test_abc123",
    });
    expect(sanitizeStripeSecret("\r\nsk_test_xyz\r\n")).toEqual({
      ok: true,
      key: "sk_test_xyz",
    });
  });

  it("accepts a clean key unchanged", () => {
    expect(sanitizeStripeSecret("sk_live_51AbCdEf")).toEqual({
      ok: true,
      key: "sk_live_51AbCdEf",
    });
  });

  it("reports missing for empty or absent values", () => {
    expect(sanitizeStripeSecret(undefined)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(sanitizeStripeSecret(null)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(sanitizeStripeSecret("")).toEqual({ ok: false, reason: "missing" });
    // Whitespace-only collapses to empty after trim -> still missing.
    expect(sanitizeStripeSecret("   \n")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports malformed for an interior space or control char a trim cannot fix", () => {
    // Interior corruption (not edge whitespace) must surface as an actionable
    // "re-set the secret" error, not silently truncate or throw INTERNAL.
    expect(sanitizeStripeSecret("sk_live abc")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(sanitizeStripeSecret("sk_live\tabc")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(sanitizeStripeSecret("sk_live_ab cd")).toEqual({
      ok: false,
      reason: "malformed",
    });
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

describe("invoice PaymentIntent resolution (Gap 2 — Basil/Clover join key)", () => {
  it("reads the PaymentIntent from the Basil payments list (string id)", () => {
    // The pinned 2026-02-25.clover API moved the PI to
    // invoice.payments.data[].payment.payment_intent. This is the value the
    // subscription refund clawback joins against (charge.payment_intent).
    expect(
      resolveInvoicePaymentIntentId({
        payments: { data: [{ payment: { payment_intent: "pi_live_123" } }] },
      }),
    ).toBe("pi_live_123");
  });

  it("reads the PaymentIntent when payments carries an expanded object", () => {
    expect(
      resolveInvoicePaymentIntentId({
        payments: { data: [{ payment: { payment_intent: { id: "pi_obj_456" } } }] },
      }),
    ).toBe("pi_obj_456");
  });

  it("skips charge-only payment entries and finds the PaymentIntent one", () => {
    // A payment entry of type "charge" leaves payment_intent unset; resolution
    // must skip it rather than returning the invoice-id fallback prematurely.
    expect(
      resolveInvoicePaymentIntentId({
        payments: {
          data: [
            { payment: { payment_intent: null } },
            { payment: { payment_intent: "pi_after_charge" } },
          ],
        },
      }),
    ).toBe("pi_after_charge");
  });

  it("falls back to the legacy top-level payment_intent for pre-Basil events", () => {
    expect(
      resolveInvoicePaymentIntentId({ payment_intent: "pi_legacy_str" }),
    ).toBe("pi_legacy_str");
    expect(
      resolveInvoicePaymentIntentId({ payment_intent: { id: "pi_legacy_obj" } }),
    ).toBe("pi_legacy_obj");
  });

  it("returns null when no PaymentIntent is present (caller must retrieve/fallback)", () => {
    // The exact pre-fix failure: a Basil invoice with no inline payments and no
    // legacy field. Returning null (not the invoice id) forces the caller to
    // expand-retrieve or log a degraded key, instead of silently storing in_xxx.
    expect(resolveInvoicePaymentIntentId({})).toBeNull();
    expect(resolveInvoicePaymentIntentId({ payments: { data: [] } })).toBeNull();
    expect(
      resolveInvoicePaymentIntentId({
        payments: { data: [{ payment: { payment_intent: null } }] },
      }),
    ).toBeNull();
    expect(
      resolveInvoicePaymentIntentId({ payments: null, payment_intent: null }),
    ).toBeNull();
  });
});

describe("ledger refund status (Gap 1 + Gap 2)", () => {
  it("marks a full refund terminal regardless of current status", () => {
    expect(ledgerRefundStatus(true, "in_release")).toBe("refunded");
    expect(ledgerRefundStatus(true, "released")).toBe("refunded");
    expect(ledgerRefundStatus(true, "releasing")).toBe("refunded");
    expect(ledgerRefundStatus(true, "")).toBe("refunded");
  });

  it("keeps a still-queued partial refund releasable so the cron pays the reduced amount", () => {
    // The Gap 1 anti-stranding rule: a partial refund before the payout is
    // claimed must NOT freeze the ledger out of the release cron.
    expect(ledgerRefundStatus(false, "in_release")).toBe("in_release");
  });

  it("sends a partial refund of a releasing/released/settled payout down the reversal path", () => {
    expect(ledgerRefundStatus(false, "releasing")).toBe("partially_refunded");
    expect(ledgerRefundStatus(false, "released")).toBe("partially_refunded");
    expect(ledgerRefundStatus(false, "partially_refunded")).toBe(
      "partially_refunded",
    );
    // An absent/unknown status is never treated as still-queued.
    expect(ledgerRefundStatus(false, "")).toBe("partially_refunded");
    expect(ledgerRefundStatus(false, null)).toBe("partially_refunded");
    expect(ledgerRefundStatus(false, undefined)).toBe("partially_refunded");
  });
});

describe("should reverse released payout (Gap 1 + Gap 2)", () => {
  it("reverses only a payout that actually left the platform", () => {
    expect(
      shouldReverseReleasedPayout({
        status: "released",
        transferId: "tr_1",
        releasedTransferAmountMinor: 9170,
      }),
    ).toBe(true);
  });

  it("does not reverse a payout still held, missing a transfer, or zero-valued", () => {
    // Still held: nothing has left the platform.
    expect(
      shouldReverseReleasedPayout({
        status: "in_release",
        transferId: "tr_1",
        releasedTransferAmountMinor: 9170,
      }),
    ).toBe(false);
    // Released but no transfer recorded (e.g. fully refunded before release).
    expect(
      shouldReverseReleasedPayout({
        status: "released",
        transferId: null,
        releasedTransferAmountMinor: 9170,
      }),
    ).toBe(false);
    // Released with a transfer but zero amount moved.
    expect(
      shouldReverseReleasedPayout({
        status: "released",
        transferId: "tr_1",
        releasedTransferAmountMinor: 0,
      }),
    ).toBe(false);
  });
});

describe("refund reversal claims (concurrent partial-refund race)", () => {
  // Baseline: $100 gross, $91.70 released to the teacher, no reversals yet.
  const base = {
    shouldReverse: true,
    grossAmountMinor: 10000,
    releasedTransferAmountMinor: 9170,
    netAmountMinor: 9170,
    alreadyReversedAmountMinor: 0,
    otherPendingReservedMinor: 0,
    existingClaim: null,
  };

  it("keys a delivery by chargeId + CUMULATIVE refunded amount", () => {
    expect(refundReversalClaimKey("ch_1", 5000)).toBe("ch_1_5000");
    // Floors fractional and clamps negative input defensively.
    expect(refundReversalClaimKey("ch_1", 5000.9)).toBe("ch_1_5000");
    expect(refundReversalClaimKey("ch_1", -1)).toBe("ch_1_0");
  });

  it("plans the proportional amount when no claim exists", () => {
    const decision = decideRefundReversalClaim({
      ...base,
      refundedAmountMinor: 5000,
    });
    expect(decision.action).toBe("execute");
    // Must match the legacy single-delivery math exactly.
    expect(decision.plannedAmountMinor).toBe(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 10000,
        refundedAmountMinor: 5000,
        releasedTransferAmountMinor: 9170,
        netAmountMinor: 9170,
        alreadyReversedAmountMinor: 0,
      }),
    );
  });

  it("skips a delivery whose claim is already done (Stripe redelivery)", () => {
    expect(
      decideRefundReversalClaim({
        ...base,
        refundedAmountMinor: 5000,
        existingClaim: { state: "done", plannedAmountMinor: 4585 },
      }),
    ).toEqual({ action: "skip", plannedAmountMinor: 0 });
  });

  it("re-executes the ORIGINAL planned amount for a pending claim (crash between phases)", () => {
    // Even if the ledger counters moved since the claim was reserved, the
    // pending claim re-issues the same amount so the stable Stripe idempotency
    // key turns the retry into a replay.
    expect(
      decideRefundReversalClaim({
        ...base,
        refundedAmountMinor: 5000,
        alreadyReversedAmountMinor: 9170,
        existingClaim: { state: "pending", plannedAmountMinor: 4585 },
      }),
    ).toEqual({ action: "execute", plannedAmountMinor: 4585 });
  });

  it("reserves against other pending claims so concurrent deliveries never over-reverse", () => {
    // Delivery A (refund 1, cumulative 5000) reserved 4585 and is mid-flight.
    // Delivery B (refund 2, cumulative 10000) must plan only the INCREMENT.
    const planned = decideRefundReversalClaim({
      ...base,
      refundedAmountMinor: 10000,
      otherPendingReservedMinor: 4585,
    });
    expect(planned.action).toBe("execute");
    expect(planned.plannedAmountMinor).toBe(9170 - 4585);
    // Sum of both deliveries equals exactly one full clawback — never more.
    expect(planned.plannedAmountMinor + 4585).toBe(9170);
  });

  it("skips when the payout never left the platform or nothing remains", () => {
    expect(
      decideRefundReversalClaim({
        ...base,
        refundedAmountMinor: 5000,
        shouldReverse: false,
      }),
    ).toEqual({ action: "skip", plannedAmountMinor: 0 });
    // Fully reversed already: increment is zero.
    expect(
      decideRefundReversalClaim({
        ...base,
        refundedAmountMinor: 10000,
        alreadyReversedAmountMinor: 9170,
      }),
    ).toEqual({ action: "skip", plannedAmountMinor: 0 });
  });

  it("createReleasedRefundTransferReversal honors the fixed planned amount", async () => {
    const createReversal = vi.fn().mockResolvedValue({ id: "trr_1" });
    const result = await createReleasedRefundTransferReversal({
      stripe: { transfers: { createReversal } },
      ledgerId: "order_1",
      transferId: "tr_1",
      // Deliberately inconsistent inputs: the fixed amount must win over any
      // recomputation (the claim froze it transactionally).
      grossAmountMinor: 0,
      refundedAmountMinor: 10000,
      releasedTransferAmountMinor: 0,
      fixedReversalAmountMinor: 4585,
      idempotencyKey: "transfer_reversal_order_1_ch_1_10000",
      metadata: { orderId: "order_1" },
    });
    expect(result).toEqual({ reversalId: "trr_1", reversalAmountMinor: 4585 });
    expect(createReversal).toHaveBeenCalledWith(
      "tr_1",
      expect.objectContaining({ amount: 4585 }),
      { idempotencyKey: "transfer_reversal_order_1_ch_1_10000" },
    );
  });
});

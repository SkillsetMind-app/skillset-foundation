import { describe, expect, it } from "vitest";

import { payoutClearDays, plans } from "@/data/plans";
import {
  affiliateCommissionRefundTargetMinor,
  canonicalPlatformFeeBpsForPlan,
  payoutReleaseDelayDays,
  isRefundableEnrollmentSource,
  nextLedgerStatusOnDispute,
  releasedRefundReversalAmountMinor,
  shouldCancelCourseSubscriptionForRefund,
  shouldMarkEnrollmentRefundedAfterChargeRefund,
  shouldReactivateEnrollment,
  shouldReverseReleasedPayout,
} from "@/lib/payments/rules";

describe("commission ladder alignment", () => {
  it("charges exactly the commission each plan displays (plans.ts vs rules.ts)", () => {
    for (const plan of plans) {
      expect(canonicalPlatformFeeBpsForPlan(plan.id)).toBe(
        plan.commissionPercent * 100,
      );
    }
  });

  it("falls back to the Free rate for unknown plans", () => {
    expect(canonicalPlatformFeeBpsForPlan("unknown")).toBe(1000);
    expect(canonicalPlatformFeeBpsForPlan(null)).toBe(1000);
    expect(canonicalPlatformFeeBpsForPlan(undefined)).toBe(1000);
  });

  it("releases payouts on the same day the displayed clearing window closes", () => {
    expect(payoutReleaseDelayDays).toBe(payoutClearDays);
  });
});

describe("affiliateCommissionRefundTargetMinor", () => {
  it("claws back the same proportion of commission as the cumulative sale refund", () => {
    expect(
      affiliateCommissionRefundTargetMinor({
        commissionAmountMinor: 1000,
        saleGrossAmountMinor: 10000,
        refundedSaleAmountMinor: 2000,
      }),
    ).toBe(200);
  });

  it("is idempotent for a redelivered cumulative refund and grows only to the new target", () => {
    const input = {
      commissionAmountMinor: 1000,
      saleGrossAmountMinor: 10000,
      refundedSaleAmountMinor: 4000,
    };

    expect(affiliateCommissionRefundTargetMinor(input)).toBe(400);
    expect(affiliateCommissionRefundTargetMinor(input)).toBe(400);
    expect(
      affiliateCommissionRefundTargetMinor({
        ...input,
        refundedSaleAmountMinor: 6000,
      }),
    ).toBe(600);
    expect(
      affiliateCommissionRefundTargetMinor({
        ...input,
        alreadyRefundedCommissionMinor: 600,
      }),
    ).toBe(600);
  });

  it("never exceeds the total commission, even for an over-reported refund", () => {
    expect(
      affiliateCommissionRefundTargetMinor({
        commissionAmountMinor: 1000,
        saleGrossAmountMinor: 10000,
        refundedSaleAmountMinor: 15000,
      }),
    ).toBe(1000);
  });

  it("returns zero for invalid or non-positive money inputs", () => {
    expect(
      affiliateCommissionRefundTargetMinor({
        commissionAmountMinor: 1000,
        saleGrossAmountMinor: 0,
        refundedSaleAmountMinor: 500,
      }),
    ).toBe(0);
    expect(
      affiliateCommissionRefundTargetMinor({
        commissionAmountMinor: 1000,
        saleGrossAmountMinor: 10000,
        refundedSaleAmountMinor: 0,
      }),
    ).toBe(0);
  });
});

describe("nextLedgerStatusOnDispute", () => {
  it("freezes a held payout when a dispute opens (the payout-during-chargeback bug)", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "in_release", hasTransfer: false }),
    ).toBe("disputed");
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "releasing", hasTransfer: false }),
    ).toBe("disputed");
    // already paid out: freeze + caller claws the transfer back
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "released", hasTransfer: true }),
    ).toBe("disputed");
  });

  it("re-arms a frozen, not-yet-paid payout when the platform wins", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "won", currentStatus: "disputed", hasTransfer: false }),
    ).toBe("in_release");
    // already transferred + clawed back on created: leave for a human, no auto-release
    expect(
      nextLedgerStatusOnDispute({ event: "won", currentStatus: "disputed", hasTransfer: true }),
    ).toBeNull();
  });

  it("terminally blocks a frozen payout when the platform loses", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "lost", currentStatus: "disputed", hasTransfer: false }),
    ).toBe("refunded");
  });

  it("no-ops on terminal/unrelated states", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "refunded", hasTransfer: false }),
    ).toBeNull();
    expect(
      nextLedgerStatusOnDispute({ event: "won", currentStatus: "in_release", hasTransfer: false }),
    ).toBeNull();
  });
});

describe("shouldReactivateEnrollment", () => {
  it("reactivates a refunded enrollment on repurchase (the charged-but-no-access bug)", () => {
    expect(shouldReactivateEnrollment("refunded")).toBe(true);
    expect(shouldReactivateEnrollment("revoked")).toBe(true);
    expect(shouldReactivateEnrollment("expired")).toBe(true);
  });

  it("never resets an already active/completed enrollment (webhook redelivery)", () => {
    expect(shouldReactivateEnrollment("active")).toBe(false);
    expect(shouldReactivateEnrollment("completed")).toBe(false);
  });
});

describe("shouldReverseReleasedPayout", () => {
  it("fires when the money left the platform even though the refund handler already flipped status to refunded (the clawback-dead bug)", () => {
    // handleChargeRefunded overwrites status to "refunded" BEFORE calling the
    // reversal. A status === "released" gate would be false here and no clawback
    // would ever run. We key on the transfer instead.
    expect(
      shouldReverseReleasedPayout({
        transferId: "tr_123",
        releasedTransferAmountMinor: 5000,
      }),
    ).toBe(true);
  });

  it("does not fire when nothing was transferred (payout still held)", () => {
    expect(
      shouldReverseReleasedPayout({
        transferId: null,
        releasedTransferAmountMinor: 0,
      }),
    ).toBe(false);
    // transferId present but zero amount (fully-refunded-before-release payout)
    expect(
      shouldReverseReleasedPayout({
        transferId: "tr_zero",
        releasedTransferAmountMinor: 0,
      }),
    ).toBe(false);
  });
});

describe("releasedRefundReversalAmountMinor", () => {
  it("reverses the full transfer on a full refund", () => {
    // $50 gross, $46 net transferred, full refund -> claw back all $46.
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 5000,
        refundedAmountMinor: 5000,
        releasedTransferAmountMinor: 4600,
      }),
    ).toBe(4600);
  });

  it("reverses proportionally on a partial refund", () => {
    // half refunded -> claw back half of what was transferred.
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 5000,
        refundedAmountMinor: 2500,
        releasedTransferAmountMinor: 4600,
      }),
    ).toBe(2300);
  });

  it("never double-claws what was already reversed", () => {
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 5000,
        refundedAmountMinor: 5000,
        releasedTransferAmountMinor: 4600,
        alreadyReversedAmountMinor: 4600,
      }),
    ).toBe(0);
  });

  it("returns 0 when nothing was transferred", () => {
    expect(
      releasedRefundReversalAmountMinor({
        grossAmountMinor: 5000,
        refundedAmountMinor: 5000,
        releasedTransferAmountMinor: 0,
      }),
    ).toBe(0);
  });
});

describe("subscription refund policy", () => {
  it("allows both one-time and subscription enrollments into the refund flow", () => {
    expect(isRefundableEnrollmentSource("payment")).toBe(true);
    expect(isRefundableEnrollmentSource("subscription")).toBe(true);
    expect(isRefundableEnrollmentSource("free")).toBe(false);
  });

  it("does not revoke the whole enrollment when one recurring invoice is refunded", () => {
    expect(
      shouldMarkEnrollmentRefundedAfterChargeRefund({
        isFullRefund: true,
        ledgerKind: "course_subscription",
      }),
    ).toBe(false);
    expect(
      shouldMarkEnrollmentRefundedAfterChargeRefund({
        isFullRefund: true,
        ledgerKind: "course_one_time",
      }),
    ).toBe(true);
  });

  it("cancels recurring billing only for a full subscription-invoice refund", () => {
    expect(
      shouldCancelCourseSubscriptionForRefund({
        isFullRefund: true,
        ledgerKind: "course_subscription",
        subscriptionId: "sub_123",
      }),
    ).toBe(true);
    expect(
      shouldCancelCourseSubscriptionForRefund({
        isFullRefund: false,
        ledgerKind: "course_subscription",
        subscriptionId: "sub_123",
      }),
    ).toBe(false);
    expect(
      shouldCancelCourseSubscriptionForRefund({
        isFullRefund: true,
        ledgerKind: "course_one_time",
        subscriptionId: null,
      }),
    ).toBe(false);
  });
});

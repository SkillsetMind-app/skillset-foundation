import { describe, expect, it } from "vitest";

import { plans } from "@/data/plans";
import {
  canonicalPlatformFeeBpsForPlan,
  isRefundableEnrollmentSource,
  ledgerRefundStatus,
  nextLedgerStatusOnDispute,
  shouldCancelCourseSubscriptionForRefund,
  shouldMarkEnrollmentRefundedAfterChargeRefund,
  shouldReactivateEnrollment,
  stripeProcessingFeeMinor,
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
});

describe("earnings ledger under direct charges", () => {
  // The platform never holds the money: Stripe debits refunds and lost disputes
  // straight from the teacher's own balance. These helpers only RECORD outcomes.
  it("records a refund without any hold/release state", () => {
    expect(ledgerRefundStatus(true)).toBe("refunded");
    expect(ledgerRefundStatus(false)).toBe("partially_refunded");
  });

  it("freezes settled earnings when a dispute opens", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "settled" }),
    ).toBe("disputed");
  });

  it("restores earnings when the teacher wins, marks refunded when they lose", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "won", currentStatus: "disputed" }),
    ).toBe("settled");
    expect(
      nextLedgerStatusOnDispute({ event: "lost", currentStatus: "disputed" }),
    ).toBe("refunded");
  });

  it("no-ops on terminal or unrelated states", () => {
    expect(
      nextLedgerStatusOnDispute({ event: "created", currentStatus: "refunded" }),
    ).toBeNull();
    expect(
      nextLedgerStatusOnDispute({ event: "won", currentStatus: "settled" }),
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

// Ported from the deleted src/domain/payment-split.test.tsx. That module encoded
// the revoked separate-charges model and its copy of this function had no
// production callers; THIS copy is the one the Stripe webhook imports, and it
// was untested. Same cases, now pointed at the live implementation.
describe("stripeProcessingFeeMinor", () => {
  it("charges the domestic rate on USD", () => {
    // 2.90% + 30c
    expect(stripeProcessingFeeMinor(10000, "USD")).toBe(320);
  });

  it("charges the international + conversion rate on everything else", () => {
    // 5.40% + 30c
    expect(stripeProcessingFeeMinor(10000, "EUR")).toBe(570);
  });

  it("is case-insensitive about the currency code", () => {
    expect(stripeProcessingFeeMinor(10000, "usd")).toBe(
      stripeProcessingFeeMinor(10000, "USD"),
    );
  });

  it("treats a missing currency as international, never as domestic", () => {
    // The order row can carry a null currency; guessing USD there would
    // under-reserve the fee on a foreign charge.
    expect(stripeProcessingFeeMinor(10000, null)).toBe(570);
    expect(stripeProcessingFeeMinor(10000)).toBe(570);
  });

  it("still applies the fixed fee to a zero-amount charge", () => {
    expect(stripeProcessingFeeMinor(0, "USD")).toBe(30);
  });
});

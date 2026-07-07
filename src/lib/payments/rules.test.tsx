import { describe, expect, it } from "vitest";

import {
  nextLedgerStatusOnDispute,
  releasedRefundReversalAmountMinor,
  shouldReactivateEnrollment,
  shouldReverseReleasedPayout,
} from "@/lib/payments/rules";

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

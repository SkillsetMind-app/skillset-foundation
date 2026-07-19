import { describe, expect, it } from "vitest";

import {
  computePaymentSplit,
  stripeProcessingFeeMinor,
} from "@/domain/payment-split";

describe("payment split — Stripe fee passed to teacher", () => {
  // Executable spec backing TEST_RESULTS.md. If these change, the documented
  // money split changed — that must be intentional.
  it.each([
    // Default = Free plan = 10% commission.
    // gross, currency, commission (10%), stripeFee, teacherNet
    [1000, "USD", 100, 59, 841],
    [5000, "USD", 500, 175, 4325],
    [10000, "USD", 1000, 320, 8680],
    [20000, "USD", 2000, 610, 17390],
    [10000, "BRL", 1000, 570, 8430],
  ])(
    "%i %s -> commission %i, stripeFee %i, net %i",
    (gross, currency, commission, stripeFee, net) => {
      const split = computePaymentSplit(gross, currency);
      expect(split.platformCommissionMinor).toBe(commission);
      expect(split.stripeFeeMinor).toBe(stripeFee);
      expect(split.teacherNetMinor).toBe(net);
      // Money conservation: nothing is created or lost.
      expect(
        split.platformCommissionMinor +
          split.stripeFeeMinor +
          split.teacherNetMinor,
      ).toBe(gross);
    },
  );

  it("treats currency case-insensitively (usd === USD)", () => {
    expect(stripeProcessingFeeMinor(10000, "usd")).toBe(
      stripeProcessingFeeMinor(10000, "USD"),
    );
  });

  it("uses the international card plus conversion estimate (5.4%) for non-USD", () => {
    expect(stripeProcessingFeeMinor(10000, "USD")).toBe(320);
    expect(stripeProcessingFeeMinor(10000, "EUR")).toBe(570);
  });

  it("never returns a negative teacher net on tiny amounts", () => {
    const split = computePaymentSplit(50, "USD");
    expect(split.teacherNetMinor).toBeGreaterThanOrEqual(0);
  });

  it("respects a custom platform fee in bps", () => {
    const split = computePaymentSplit(10000, "USD", 1000); // 10% tier (Free)
    expect(split.platformCommissionMinor).toBe(1000);
    expect(split.stripeFeeMinor).toBe(320);
    expect(split.teacherNetMinor).toBe(10000 - 1000 - 320);
  });

  it.each([
    // $100 USD card across each subscription tier.
    // bps, commission, stripeFee, teacherNet
    [1000, 1000, 320, 8680], // Free   — 10%
    [500, 500, 320, 9180], //   Starter — 5%
    [300, 300, 320, 9380], //   Pro    — 3%
    [200, 200, 320, 9480], //   Plus   — 2%
  ])(
    "tier %i bps -> commission %i, stripeFee %i, net %i",
    (bps, commission, stripeFee, net) => {
      const split = computePaymentSplit(10000, "USD", bps);
      expect(split.platformCommissionMinor).toBe(commission);
      expect(split.stripeFeeMinor).toBe(stripeFee);
      expect(split.teacherNetMinor).toBe(net);
    },
  );
});

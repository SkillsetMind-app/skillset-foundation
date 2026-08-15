import { describe, expect, it } from "vitest";

import {
  defaultSkillsetCurrency,
  fromStripeAmount,
  isSupportedStripeCurrency,
  normalizeSkillsetCurrency,
  supportedStripeCurrencies,
  toStripeAmount,
  topSkillsetCurrencies,
} from "@/lib/payments/currencies";

describe("isSupportedStripeCurrency", () => {
  it("is case-insensitive", () => {
    expect(isSupportedStripeCurrency("usd")).toBe(true);
    expect(isSupportedStripeCurrency("UsD")).toBe(true);
  });

  it("rejects anything off the list", () => {
    expect(isSupportedStripeCurrency("XYZ")).toBe(false);
    expect(isSupportedStripeCurrency("")).toBe(false);
  });
});

describe("normalizeSkillsetCurrency", () => {
  it("falls back to the default instead of throwing", () => {
    // This runs on stored data, so an unknown or missing value must degrade to
    // USD rather than reach Stripe as an invalid currency.
    expect(normalizeSkillsetCurrency(null)).toBe(defaultSkillsetCurrency);
    expect(normalizeSkillsetCurrency("")).toBe(defaultSkillsetCurrency);
    expect(normalizeSkillsetCurrency("  ")).toBe(defaultSkillsetCurrency);
    expect(normalizeSkillsetCurrency("XYZ")).toBe(defaultSkillsetCurrency);
  });

  it("trims and upcases a supported value", () => {
    expect(normalizeSkillsetCurrency("  brl ")).toBe("BRL");
  });
});

describe("toStripeAmount", () => {
  // Our stored convention is ALWAYS value x 100. Stripe's smallest unit is not.
  // If these two ever disagree silently, the buyer's card is charged 100x and
  // every screen still shows the right number, because Intl.NumberFormat
  // renders JPY with zero fraction digits.

  it("passes two-decimal currencies through untouched", () => {
    expect(toStripeAmount(100000, "USD")).toBe(100000);
    expect(toStripeAmount(100000, "BRL")).toBe(100000);
    expect(toStripeAmount(0, "GYD")).toBe(0);
  });

  it("divides zero-decimal currencies by 100", () => {
    // Teacher types 1000 in the studio -> stored 100000 -> Stripe must receive
    // 1000, or the buyer is charged 100,000 yen for a 1,000 yen course.
    expect(toStripeAmount(100000, "JPY")).toBe(1000);
    expect(toStripeAmount(100000, "CLP")).toBe(1000);
  });

  it("is case-insensitive on the currency code", () => {
    expect(toStripeAmount(100000, "jpy")).toBe(1000);
  });

  it("rounds a fractional unit rather than truncating it", () => {
    // A currency with no sub-unit cannot express the half. Rounding down would
    // let a teacher shave a unit off every sale.
    expect(toStripeAmount(100050, "JPY")).toBe(1001);
    expect(toStripeAmount(100049, "JPY")).toBe(1000);
  });

  it("covers every zero-decimal currency we actually offer", () => {
    // Stripe's zero-decimal list intersected with ours. If a future currency is
    // added to supportedStripeCurrencies from this set, this test fails until
    // toStripeAmount knows about it.
    const stripeZeroDecimal = [
      "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
      "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
    ];
    const ours = stripeZeroDecimal.filter((c) =>
      (supportedStripeCurrencies as readonly string[]).includes(c),
    );

    expect(ours.sort()).toEqual(["CLP", "JPY"]);

    for (const currency of ours) {
      expect(toStripeAmount(100000, currency)).toBe(1000);
    }
  });

  it("leaves every other supported currency at 1/100", () => {
    for (const currency of supportedStripeCurrencies) {
      if (currency === "JPY" || currency === "CLP") continue;
      expect(toStripeAmount(12345, currency)).toBe(12345);
    }
  });

  it("never sends a zero amount for a positive price", () => {
    // There is no minimum-price floor in the studio, so a teacher can set
    // ¥0.49. Rounding that to 0 would leave for Stripe as a zero-amount charge,
    // which it rejects — a paid course nobody can ever buy.
    expect(toStripeAmount(49, "JPY")).toBe(1);
    expect(toStripeAmount(1, "JPY")).toBe(1);
    // A genuinely free course still converts to 0, not 1.
    expect(toStripeAmount(0, "JPY")).toBe(0);
  });
});

describe("fromStripeAmount", () => {
  // Amounts READ BACK from Stripe (invoice totals, refunded totals) arrive in
  // Stripe's unit. The ledger, the refund cap and every display site assume
  // ours, so the reverse conversion has to happen at the same boundary.

  it("passes two-decimal currencies through untouched", () => {
    expect(fromStripeAmount(100000, "USD")).toBe(100000);
    expect(fromStripeAmount(0, "BRL")).toBe(0);
  });

  it("multiplies zero-decimal currencies by 100", () => {
    // A ¥1,000 subscription renewal arrives as 1000. Stored raw, the teacher's
    // ledger would read ¥10 and our commission would be booked 100x too low.
    expect(fromStripeAmount(1000, "JPY")).toBe(100000);
    expect(fromStripeAmount(1000, "clp")).toBe(100000);
  });

  it("round-trips with toStripeAmount", () => {
    for (const currency of supportedStripeCurrencies) {
      expect(fromStripeAmount(toStripeAmount(100000, currency), currency)).toBe(
        100000,
      );
    }
  });
});

describe("the currency lists themselves", () => {
  it("keeps the top list a subset of the supported list", () => {
    // The studio renders "Most used" and "Other supported" from these two, so a
    // top-list entry missing from the supported list would render a currency
    // that normalizeSkillsetCurrency then silently rewrites to USD.
    for (const currency of topSkillsetCurrencies) {
      expect(isSupportedStripeCurrency(currency)).toBe(true);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(supportedStripeCurrencies).size).toBe(
      supportedStripeCurrencies.length,
    );
  });
});

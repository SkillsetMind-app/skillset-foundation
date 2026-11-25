import { describe, expect, it } from "vitest";

import {
  buildInstallmentPlan,
  canSplitPayments,
  normalizeInstallmentsMax,
} from "@/domain/installments";

describe("installments", () => {
  it("normalizes max into 1..24", () => {
    expect(normalizeInstallmentsMax(12)).toBe(12);
    expect(normalizeInstallmentsMax(0)).toBe(1);
    expect(normalizeInstallmentsMax(99)).toBe(24);
  });

  it("enables Stripe card installments only for MXN on a Mexico account", () => {
    const plan = buildInstallmentPlan({
      amountMinor: 12_000,
      installmentsEnabled: true,
      installmentsMax: 3,
      currency: "MXN",
      stripeAccountCountry: "MX",
    });
    expect(plan.enabled).toBe(true);
    expect(plan.options).toHaveLength(2);
    expect(plan.options[0].count).toBe(2);
    expect(plan.options[0].amountMinor).toBe(6000);
    expect(plan.stripeCardInstallmentsEligible).toBe(true);
  });

  it("rejects BRL and MXN on a non-Mexico Stripe account", () => {
    expect(
      buildInstallmentPlan({
        amountMinor: 10_000,
        installmentsEnabled: true,
        installmentsMax: 6,
        currency: "BRL",
        stripeAccountCountry: "BR",
      }).stripeCardInstallmentsEligible,
    ).toBe(false);
    expect(
      buildInstallmentPlan({
        amountMinor: 10_000,
        installmentsEnabled: true,
        installmentsMax: 6,
        currency: "MXN",
        stripeAccountCountry: "US",
      }).stripeCardInstallmentsEligible,
    ).toBe(false);
  });

  it("disables for free/zero and marks USD as non-stripe-eligible", () => {
    expect(
      buildInstallmentPlan({
        amountMinor: 0,
        installmentsEnabled: true,
        installmentsMax: 6,
        currency: "USD",
        stripeAccountCountry: "MX",
      }).enabled,
    ).toBe(false);
    expect(
      buildInstallmentPlan({
        amountMinor: 10_000,
        installmentsEnabled: true,
        installmentsMax: 6,
        currency: "USD",
        stripeAccountCountry: "MX",
      }).stripeCardInstallmentsEligible,
    ).toBe(false);
  });
});

// "Let people pay in installments" only shows where it works: the same rule as the
// checkout (flag payments.cardInstallments + MXN + Stripe account in Mexico).
describe("canSplitPayments", () => {
  it.each([
    [true, "MXN", "MX", true],
    [true, "mxn", "mx", true],
    [false, "MXN", "MX", false],
    [true, "USD", "MX", false],
    [true, "MXN", "US", false],
    [true, "MXN", null, false],
    [true, "BRL", "BR", false],
  ] as const)("flag %s, %s, conta %s: %s", (featureEnabled, currency, stripeAccountCountry, expected) => {
    expect(canSplitPayments({ featureEnabled, currency, stripeAccountCountry })).toBe(expected);
  });

  it("agrees with the eligibility the checkout reads from the plan", () => {
    const plan = (currency: string, country: string) =>
      buildInstallmentPlan({ amountMinor: 30000, installmentsEnabled: true, installmentsMax: 3, currency, stripeAccountCountry: country });
    for (const [currency, country] of [["MXN", "MX"], ["USD", "MX"], ["MXN", "US"]]) {
      expect(canSplitPayments({ featureEnabled: true, currency, stripeAccountCountry: country })).toBe(
        plan(currency, country).stripeCardInstallmentsEligible,
      );
    }
  });

  it("the preview: 3x of 100 on a price of 300", () => {
    expect(buildInstallmentPlan({ amountMinor: 30000, installmentsEnabled: true, installmentsMax: 3, currency: "MXN" }).options.at(-1))
      .toMatchObject({ count: 3, amountMinor: 10000 });
  });
});

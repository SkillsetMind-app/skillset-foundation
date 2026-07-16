import { describe, expect, it } from "vitest";

import { buildInstallmentPlan, normalizeInstallmentsMax } from "@/domain/installments";

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

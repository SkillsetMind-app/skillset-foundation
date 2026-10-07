import { describe, expect, it } from "vitest";

import {
  formatPlanCommission,
  hasRealPortalConfigurationId,
  isBillingConfigured,
  isPlanEntitledStatus,
  isPublicPlanId,
  planAndCycleByStripePriceId,
  planById,
  plans,
  publicPlans,
  RECOMMENDED_PLAN_ID,
} from "@/data/plans";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";

describe("the 2026-10 price table", () => {
  it("offers Basic, Starter and Pro, with Starter recommended and no free plan", () => {
    expect(publicPlans.map((plan) => plan.id)).toEqual(["basic", "starter", "pro"]);
    expect(RECOMMENDED_PLAN_ID).toBe("starter");
    for (const id of ["basic", "starter", "pro"]) expect(isPublicPlanId(id)).toBe(true);
    expect(isPublicPlanId("free")).toBe(false);
    expect(isPublicPlanId("plus")).toBe(false);
  });

  it("prices and commissions match the founder's table", () => {
    expect(planById("basic")).toMatchObject({ monthlyUsd: 5, yearlyUsd: 50, commissionPercent: 10 });
    expect(planById("starter")).toMatchObject({ monthlyUsd: 19, yearlyUsd: 190, commissionPercent: 4.9 });
    expect(planById("pro")).toMatchObject({ monthlyUsd: 89, yearlyUsd: 890, commissionPercent: 2.9 });
    expect(planById("plus")).toMatchObject({ name: "Enterprise", monthlyUsd: 199, commissionPercent: 1.9 });
    // ~17% off: two months free on the yearly price.
    for (const plan of publicPlans) expect(plan.yearlyUsd).toBe(plan.monthlyUsd * 10);
    expect(formatPlanCommission(planById("starter"))).toBe("4.9% + $0.30");
  });

  it("keeps the displayed percent and the charged basis points in step", () => {
    for (const plan of plans) {
      expect(Math.round(plan.commissionPercent * 100)).toBe(canonicalPlatformFeeBpsForPlan(plan.id));
    }
    // An account with no plan pays Basic's rate; no tier is ever 0%.
    expect(canonicalPlatformFeeBpsForPlan("free")).toBe(canonicalPlatformFeeBpsForPlan("basic"));
    for (const plan of plans) expect(canonicalPlatformFeeBpsForPlan(plan.id)).toBeGreaterThan(0);
  });

  it("hides Enterprise but still resolves an existing Enterprise (ex-Plus) subscription", () => {
    const enterprise = planById("plus");
    expect(enterprise.hidden).toBe(true);
    expect(publicPlans).not.toContain(enterprise);
    expect(planAndCycleByStripePriceId(enterprise.stripePriceIds!.monthlyId)).toEqual({ plan: enterprise, cycle: "monthly" });
    expect(planAndCycleByStripePriceId(enterprise.stripePriceIds!.yearlyId)).toEqual({ plan: enterprise, cycle: "yearly" });
  });

  it("keeps the existing $19 Starter Prices as Starter's current Prices", () => {
    const starter = planById("starter");
    expect(planAndCycleByStripePriceId(starter.stripePriceIds!.monthlyId)).toEqual({ plan: starter, cycle: "monthly" });
    expect(planAndCycleByStripePriceId("price_unknown")).toBeUndefined();
  });

  it("counts a trialing subscription as active", () => {
    expect(isPlanEntitledStatus("trialing")).toBe(true);
    expect(isPlanEntitledStatus("active")).toBe(true);
    for (const status of ["past_due", "unpaid", "canceled", "incomplete", null]) {
      expect(isPlanEntitledStatus(status)).toBe(false);
    }
  });
});

describe("the billing portal gate", () => {
  it("rejects a placeholder portal configuration id and accepts a real one", () => {
    expect(hasRealPortalConfigurationId("bpc_PLACEHOLDER_basic_starter_pro")).toBe(false);
    expect(hasRealPortalConfigurationId("bpc_1Qabc123")).toBe(true);
  });

  it("is not configured while the portal id in the repo is still the placeholder", () => {
    expect(isBillingConfigured()).toBe(false);
  });
});

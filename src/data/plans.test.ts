import { describe, expect, it } from "vitest";

import {
  isPlanEntitledStatus,
  isPublicPlanId,
  planAndCycleByStripePriceId,
  planById,
  planByStripePriceId,
  plans,
  publicPlans,
  RECOMMENDED_PLAN_ID,
} from "@/data/plans";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";

describe("the 2026-10 price table", () => {
  it("offers Starter and Pro only, with Starter recommended", () => {
    expect(publicPlans.map((plan) => plan.id)).toEqual(["starter", "pro"]);
    expect(RECOMMENDED_PLAN_ID).toBe("starter");
    expect(isPublicPlanId("starter")).toBe(true);
    expect(isPublicPlanId("pro")).toBe(true);
    expect(isPublicPlanId("plus")).toBe(false);
    expect(isPublicPlanId("free")).toBe(false);
  });

  it("prices Starter at $5/$50 and keeps Pro at $89/$890", () => {
    expect(planById("starter")).toMatchObject({ monthlyUsd: 5, yearlyUsd: 50, commissionPercent: 4.9 });
    expect(planById("pro")).toMatchObject({ monthlyUsd: 89, yearlyUsd: 890, commissionPercent: 0 });
    // ~17% off: two months free on the yearly price.
    for (const plan of publicPlans) expect(plan.yearlyUsd).toBe(plan.monthlyUsd * 10);
  });

  it("keeps the displayed percent and the charged basis points in step", () => {
    for (const plan of plans) {
      expect(Math.round(plan.commissionPercent * 100)).toBe(canonicalPlatformFeeBpsForPlan(plan.id));
    }
    expect(canonicalPlatformFeeBpsForPlan("free")).toBe(1000);
    expect(canonicalPlatformFeeBpsForPlan("starter")).toBe(490);
    expect(canonicalPlatformFeeBpsForPlan("pro")).toBe(0);
  });

  it("hides the retired Plus but still resolves an existing Plus subscription", () => {
    const plus = planById("plus");
    expect(plus.retired).toBe(true);
    expect(publicPlans).not.toContain(plus);
    expect(planAndCycleByStripePriceId(plus.stripePriceIds!.monthlyId)).toEqual({ plan: plus, cycle: "monthly" });
    expect(planAndCycleByStripePriceId(plus.stripePriceIds!.yearlyId)).toEqual({ plan: plus, cycle: "yearly" });
    expect(canonicalPlatformFeeBpsForPlan("plus")).toBe(200);
  });

  it("still reads a $19 Starter subscription as Starter, with its cycle", () => {
    const starter = planById("starter");
    const [legacy] = starter.legacyStripePriceIds!;
    expect(planAndCycleByStripePriceId(legacy.monthlyId)).toEqual({ plan: starter, cycle: "monthly" });
    expect(planAndCycleByStripePriceId(legacy.yearlyId)).toEqual({ plan: starter, cycle: "yearly" });
    expect(planByStripePriceId(starter.stripePriceIds!.monthlyId)).toBe(starter);
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

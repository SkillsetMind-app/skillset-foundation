import { describe, expect, it } from "vitest";

import { planById, plans } from "@/data/plans";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";
import {
  expectedFeePercent,
  feeDrifted,
  OLD_STARTER_PRICES,
  PLUS_PRICES,
  RATE_BPS,
} from "../../../scripts/plan-repricing.mjs";

// scripts/plan-repricing.mjs is plain Node and cannot import the TypeScript
// sources, so it carries its own copy of the ladder and the Price ids.
describe("scripts/plan-repricing.mjs", () => {
  it("carries the same commission ladder the checkout charges", () => {
    for (const plan of plans) {
      expect(RATE_BPS[plan.id]).toBe(canonicalPlatformFeeBpsForPlan(plan.id));
    }
  });

  it("targets the $19 Starter Prices and the retired Plus Prices from plans.ts", () => {
    expect(planById("starter").legacyStripePriceIds).toContainEqual({
      monthlyId: OLD_STARTER_PRICES.monthly,
      yearlyId: OLD_STARTER_PRICES.yearly,
    });
    const plus = planById("plus").stripePriceIds!;
    expect(PLUS_PRICES).toEqual([plus.monthlyId, plus.yearlyId]);
  });

  it("flags a student subscription whose frozen percent is not the creator's rate", () => {
    for (const plan of plans) {
      const percent = expectedFeePercent(plan.id);
      expect(feeDrifted(percent, plan.id)).toBe(false);
      expect(feeDrifted((percent ?? 0) + 1, plan.id)).toBe(true);
    }
    // A subscription with no percent pays no fee: drifted unless the plan is 0%.
    expect(feeDrifted(null, "free")).toBe(true);
  });
});

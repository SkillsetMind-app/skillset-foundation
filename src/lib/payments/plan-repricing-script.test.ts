import { describe, expect, it } from "vitest";

import { planById, plans } from "@/data/plans";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";
import {
  ENTERPRISE_PRICES,
  expectedFeePercent,
  feeDrifted,
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

  it("counts Enterprise on the Prices plans.ts gives it", () => {
    const enterprise = planById("plus").stripePriceIds!;
    expect(ENTERPRISE_PRICES).toEqual([enterprise.monthlyId, enterprise.yearlyId]);
  });

  it("flags a student subscription whose frozen percent is not the creator's rate", () => {
    for (const plan of plans) {
      expect(feeDrifted(expectedFeePercent(plan.id), plan.id)).toBe(false);
      expect(feeDrifted(expectedFeePercent(plan.id) + 1, plan.id)).toBe(true);
    }
    // The old ladder: Starter froze 5%, Pro 3%.
    expect(feeDrifted(5, "starter")).toBe(true);
    expect(feeDrifted(3, "pro")).toBe(true);
    // A subscription with no percent pays no fee: always drifted now.
    expect(feeDrifted(null, "pro")).toBe(true);
  });
});

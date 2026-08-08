import { describe, expect, it } from "vitest";

import {
  effectiveLimit,
  formatLimit,
  hasFeature,
  lowestPlanWithFeature,
  lowestPlanWithQuota,
  planEntitlements,
  quotaStatus,
} from "@/domain/entitlements";

describe("plan entitlements", () => {
  it("keeps the featured-slot quota in step with the SQL enforcement copy", () => {
    // Mirrors featured_slots_for_plan() in
    // supabase/migrations/20260808120000_self_serve_course_featuring.sql.
    // If this fails, the teacher sees one number and the server enforces
    // another.
    expect(planEntitlements.free.quotas.featuredSlots).toBe(0);
    expect(planEntitlements.starter.quotas.featuredSlots).toBe(1);
    expect(planEntitlements.pro.quotas.featuredSlots).toBe(3);
    expect(planEntitlements.plus.quotas.featuredSlots).toBe(5);
  });

  it("keeps the certificate-logo gate in step with the SQL enforcement copy", () => {
    // issue_skillset_certificate() in
    // supabase/migrations/20260808130000_certificate_teacher_brand_logo.sql
    // stamps the teacher's brand mark whenever current_plan_id <> 'free'.
    // Flipping any paid tier off here without touching the SQL would show a
    // locked feature in the UI while the server keeps printing the logo.
    for (const planId of ["free", "starter", "pro", "plus"] as const) {
      expect(hasFeature(planId, "certificateOwnLogo")).toBe(planId !== "free");
    }
  });

  it("keeps the storefront-template gate in step with the SQL enforcement copy", () => {
    // public_storefront_projection() in
    // supabase/migrations/20260808140000_storefront_public_projection.sql
    // returns null for `free` and the sanitized config for every other plan.
    // Turning a paid tier off here without touching the SQL would show a
    // locked feature while the public vitrine keeps rendering the theme.
    for (const planId of ["free", "starter", "pro", "plus"] as const) {
      expect(hasFeature(planId, "storefrontTemplates")).toBe(planId !== "free");
    }
  });

  it("raises a limit with an approved grant but never lowers one", () => {
    expect(effectiveLimit("starter", "featuredSlots", 4)).toBe(4);
    expect(effectiveLimit("pro", "featuredSlots", 1)).toBe(3);
    expect(effectiveLimit("pro", "featuredSlots", undefined)).toBe(3);
  });

  it("treats unlimited as unbeatable, in both directions", () => {
    expect(effectiveLimit("plus", "publishedProducts", 10)).toBeNull();
    expect(effectiveLimit("starter", "publishedProducts", null)).toBeNull();
  });

  it("reports remaining slots and blocks consumption at the limit", () => {
    expect(quotaStatus(1, 3)).toMatchObject({
      remaining: 2,
      canConsume: true,
      lockedOnPlan: false,
    });
    expect(quotaStatus(3, 3)).toMatchObject({ remaining: 0, canConsume: false });
    // Over quota after a downgrade: never a negative remaining.
    expect(quotaStatus(7, 3)).toMatchObject({ remaining: 0, canConsume: false });
  });

  it("separates 'not included on this plan' from 'used it all up'", () => {
    expect(quotaStatus(0, 0)).toMatchObject({
      canConsume: false,
      lockedOnPlan: true,
      fraction: 1,
    });
    expect(quotaStatus(0, 5)).toMatchObject({
      canConsume: true,
      lockedOnPlan: false,
      fraction: 0,
    });
  });

  it("never fills the progress bar for an unlimited quota", () => {
    expect(quotaStatus(9_999, null)).toMatchObject({
      remaining: null,
      canConsume: true,
      fraction: 0,
    });
  });

  it("names the cheapest plan that unlocks a feature", () => {
    expect(lowestPlanWithFeature("certificateOwnLogo")).toBe("starter");
    expect(lowestPlanWithFeature("removePlatformBranding")).toBe("pro");
  });

  it("names the cheapest plan that covers a needed amount", () => {
    expect(lowestPlanWithQuota("featuredSlots", 1)).toBe("starter");
    expect(lowestPlanWithQuota("featuredSlots", 4)).toBe("plus");
    expect(lowestPlanWithQuota("featuredSlots", 99)).toBeNull();
    // Unlimited covers any request.
    expect(lowestPlanWithQuota("publishedProducts", 10_000)).toBe("plus");
  });

  it("gates whitelabel to the paid tiers that were sold on it", () => {
    expect(hasFeature("free", "removePlatformBranding")).toBe(false);
    expect(hasFeature("starter", "removePlatformBranding")).toBe(false);
    expect(hasFeature("pro", "removePlatformBranding")).toBe(true);
  });

  it("labels limits the way the teacher reads them", () => {
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(0)).toBe("Not included");
    expect(formatLimit(30_000)).toBe("30,000");
  });
});

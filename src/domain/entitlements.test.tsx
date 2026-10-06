import { describe, expect, it } from "vitest";

import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";
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
    // supabase/migrations/20261006040000_precos_3_planos_teste_gratis.sql.
    // If this fails, the teacher sees one number and the server enforces
    // another.
    expect(planEntitlements.free.quotas.featuredSlots).toBe(0);
    expect(planEntitlements.starter.quotas.featuredSlots).toBe(1);
    expect(planEntitlements.pro.quotas.featuredSlots).toBe(5);
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

  it("keeps the sales-page block quota in step with the SQL enforcement copy", () => {
    // Mirrors landing_block_limit_for_plan() in
    // supabase/migrations/20260820010000_course_landing_pages.sql. Free is 4
    // rather than 0 on purpose: it gets a complete short page, not a crippled
    // long one.
    expect(planEntitlements.free.quotas.landingBlocks).toBe(4);
    expect(planEntitlements.starter.quotas.landingBlocks).toBe(8);
    expect(planEntitlements.pro.quotas.landingBlocks).toBe(20);
    expect(planEntitlements.plus.quotas.landingBlocks).toBe(20);
  });

  it("keeps the custom-domain quota in step with the SQL enforcement copy", () => {
    // Mirrors custom_domain_limit_for_plan() in
    // supabase/migrations/20261006040000_precos_3_planos_teste_gratis.sql. Free stays at 0
    // deliberately: claim_custom_domain() refuses outright at 0, so raising it
    // here without touching the SQL would offer the teacher a button that the
    // server always rejects.
    expect(planEntitlements.free.quotas.customDomains).toBe(0);
    expect(planEntitlements.starter.quotas.customDomains).toBe(1);
    expect(planEntitlements.pro.quotas.customDomains).toBe(5);
    expect(planEntitlements.plus.quotas.customDomains).toBe(5);
  });

  // The drift tests above copy the SQL's numbers by hand, which catches a change
  // to the TypeScript and misses a change to the migration — the more likely
  // direction, since the migration is the side someone edits when enforcement is
  // wrong. The two below read both files and compare them, so editing either
  // side alone fails the build.
  it("reads the landing migration and refuses to let the two sides drift", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      "supabase/migrations/20260820010000_course_landing_pages.sql",
      "utf8",
    );
    const body = sql.slice(sql.indexOf("function public.landing_block_limit_for_plan"));

    const fromSql = (planId: string): number => {
      const match = body.match(new RegExp(`when '${planId}'\\s+then\\s+(\\d+)`));
      if (!match) {
        throw new Error(`landing_block_limit_for_plan has no branch for ${planId}`);
      }
      return Number(match[1]);
    };

    // `free` is the else branch, so it is matched separately.
    const free = body.match(/else\s+(\d+)\s*--\s*free/);
    expect(Number(free?.[1])).toBe(planEntitlements.free.quotas.landingBlocks);

    for (const planId of ["starter", "pro", "plus"] as const) {
      expect(fromSql(planId)).toBe(planEntitlements[planId].quotas.landingBlocks);
    }
  });

  it("reads the migration and refuses to let the two sides drift apart", async () => {
    const { readFileSync } = await import("node:fs");
    // The newest definition: 20261006040000 replaced the one in
    // 20260820000000_custom_domains.sql.
    const sql = readFileSync(
      "supabase/migrations/20261006040000_precos_3_planos_teste_gratis.sql",
      "utf8",
    );

    const body = sql.slice(
      sql.indexOf("function public.custom_domain_limit_for_plan"),
    );

    const fromSql = (planId: string): number => {
      const match = body.match(
        new RegExp(`when '${planId}'\\s+then\\s+(\\d+)`),
      );
      if (!match) {
        throw new Error(`custom_domain_limit_for_plan has no branch for ${planId}`);
      }
      return Number(match[1]);
    };

    // `free` is the else branch rather than a named `when`, so it is asserted
    // separately — and it is the one that matters most: a non-zero default
    // would hand every free account a custom domain.
    expect(body).toMatch(/else\s+0\b/);

    for (const planId of ["starter", "pro", "plus"] as const) {
      expect(fromSql(planId)).toBe(planEntitlements[planId].quotas.customDomains);
    }
  });

  it("reads the featured-slot and commission functions from the newest migration", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261006040000_precos_3_planos_teste_gratis.sql", "utf8");
    const branch = (fn: string, planId: string): number => {
      const body = sql.slice(sql.indexOf(`function public.${fn}`));
      const match = body.match(new RegExp(`when '${planId}'\\s+then\\s+(\\d+)`));
      if (!match) throw new Error(`${fn} has no branch for ${planId}`);
      return Number(match[1]);
    };
    for (const planId of ["starter", "pro", "plus"] as const) {
      expect(branch("featured_slots_for_plan", planId)).toBe(planEntitlements[planId].quotas.featuredSlots);
    }
    for (const planId of ["free", "starter", "pro", "plus"] as const) {
      expect(branch("platform_fee_bps_for_plan", planId)).toBe(canonicalPlatformFeeBpsForPlan(planId));
    }
  });

  it("gives Pro the retired Plus limits except a 3,000 active-student cap", () => {
    const { activeStudents: proStudents, ...proRest } = planEntitlements.pro.quotas;
    const { activeStudents: plusStudents, ...plusRest } = planEntitlements.plus.quotas;
    expect(proRest).toEqual(plusRest);
    expect(planEntitlements.pro.features).toEqual(planEntitlements.plus.features);
    expect(proStudents).toBe(3_000);
    // Grandfathered: an existing Plus subscription keeps unlimited students.
    expect(plusStudents).toBeNull();
    expect(planEntitlements.starter.quotas).toMatchObject({
      publishedProducts: 5,
      activeStudents: 300,
      videoStorageMinutes: 600,
      customDomains: 1,
      teamSeats: 2,
      emailSendsPerMonth: 2_000,
    });
  });

  it("stops Pro at 3,000 active students and sends the teacher to Contact us, not to a plan", () => {
    expect(effectiveLimit("pro", "activeStudents")).toBe(3_000);
    expect(quotaStatus(2_999, effectiveLimit("pro", "activeStudents")).canConsume).toBe(true);
    expect(quotaStatus(3_000, effectiveLimit("pro", "activeStudents")).canConsume).toBe(false);
    // No public plan covers the 3,001st student: null is the "Contact us" path.
    expect(lowestPlanWithQuota("activeStudents", 3_001)).toBeNull();
    // An approved expansion still lifts it, like any quota.
    expect(effectiveLimit("pro", "activeStudents", 5_000)).toBe(5_000);
  });

  it("raises a limit with an approved grant but never lowers one", () => {
    expect(effectiveLimit("starter", "featuredSlots", 4)).toBe(4);
    expect(effectiveLimit("pro", "featuredSlots", 1)).toBe(5);
    expect(effectiveLimit("pro", "featuredSlots", undefined)).toBe(5);
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
    expect(lowestPlanWithQuota("featuredSlots", 4)).toBe("pro");
    expect(lowestPlanWithQuota("featuredSlots", 99)).toBeNull();
    // Unlimited covers any request.
    expect(lowestPlanWithQuota("publishedProducts", 10_000)).toBe("pro");
    // The retired Plus is never the answer, even where it alone would cover it.
    expect(lowestPlanWithQuota("activeStudents", 1_000_000)).toBeNull();
  });

  it("gates whitelabel to the paid tiers that were sold on it", () => {
    // Both halves of
    // supabase/migrations/20260808150000_whitelabel_platform_brand.sql read
    // `current_plan_id in ('pro','plus')`: issue_skillset_certificate() stamps
    // certificates.hide_platform_brand, and public_storefront_projection()
    // publishes branding.hidePlatformBrand for the member area. Flipping a tier
    // here without touching the SQL would sell the removal on a plan whose
    // certificates and classroom still print our mark.
    expect(hasFeature("free", "removePlatformBranding")).toBe(false);
    expect(hasFeature("starter", "removePlatformBranding")).toBe(false);
    expect(hasFeature("pro", "removePlatformBranding")).toBe(true);
    expect(hasFeature("plus", "removePlatformBranding")).toBe(true);
  });

  it("labels limits the way the teacher reads them", () => {
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(0)).toBe("Not included");
    expect(formatLimit(30_000)).toBe("30,000");
  });
});

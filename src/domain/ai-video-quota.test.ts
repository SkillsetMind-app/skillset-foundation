// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { planEntitlements } from "./entitlements";

// The AI cap lives in two places: aiVideoMinutesPerMonth (what the screen shows)
// and ai_video_seconds_limit_for_plan (what the database charges). This test reads the
// migration and locks the two together.
describe("AI video quota", () => {
  const sql = readFileSync("supabase/migrations/20261114010000_ia_do_professor.sql", "utf8");
  const body = sql.slice(sql.indexOf("function public.ai_video_seconds_limit_for_plan"));
  const branch = (planId: string): number => {
    const match = body.match(new RegExp(`when '${planId}'\\s+then\\s+(\\d+)`));
    if (!match) throw new Error(`no branch for ${planId}`);
    return Number(match[1]);
  };

  it("matches the database cap on every paid plan", () => {
    for (const planId of ["starter", "pro", "plus"] as const) {
      expect(branch(planId) / 60).toBe(planEntitlements[planId].quotas.aiVideoMinutesPerMonth);
    }
  });

  it("gives free and Basic the else branch: 2 hours, never zero", () => {
    const fallback = Number(body.match(/else\s+(\d+)/)?.[1]);
    expect(fallback / 60).toBe(planEntitlements.basic.quotas.aiVideoMinutesPerMonth);
    expect(planEntitlements.free.quotas.aiVideoMinutesPerMonth).toBe(120);
    expect(planEntitlements.basic.quotas.aiVideoMinutesPerMonth).toBe(120);
  });

  it("is on in every plan", () => {
    for (const plan of Object.values(planEntitlements)) {
      expect(plan.quotas.aiVideoMinutesPerMonth).toBeGreaterThan(0);
    }
  });
});

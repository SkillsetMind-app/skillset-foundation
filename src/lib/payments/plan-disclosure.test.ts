import { describe, expect, it } from "vitest";

import { planById, type PlanBillingCycle } from "@/data/plans";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { formatTrialDate, planDisclosure, planTrialEnd } from "@/lib/payments/plan-disclosure";

// Noon UTC: the trial ends 2026-10-20 at noon UTC, which is already the 20th
// in UTC−12. The deadline date must never be later than that anywhere.
const now = new Date("2026-10-06T12:00:00Z");

function disclosure(locale: "en" | "es", planId: "basic" | "starter" | "pro", cycle: PlanBillingCycle, trial: boolean) {
  const dict = getDictionary(locale);
  return planDisclosure({
    t: (key) => translate(dict, key),
    locale,
    plan: planById(planId),
    cycle,
    trial,
    now,
  });
}

describe("renewal disclosure (US ROSCA)", () => {
  it.each([
    ["basic", "monthly", "14 days free, then $5/month."],
    ["basic", "yearly", "14 days free, then $50/year."],
    ["starter", "monthly", "14 days free, then $19/month."],
    ["starter", "yearly", "14 days free, then $190/year."],
    ["pro", "monthly", "14 days free, then $89/month."],
    ["pro", "yearly", "14 days free, then $890/year."],
  ] as const)("states the %s %s price, renewal and deadline in English", (planId, cycle, opening) => {
    expect(disclosure("en", planId, cycle, true)).toBe(
      `${opening} Renews automatically until you cancel. Cancel anytime in Billing before October 20, 2026 and you won't be charged.`,
    );
  });

  it.each([
    ["basic", "monthly", "14 días gratis, luego $5 al mes."],
    ["basic", "yearly", "14 días gratis, luego $50 al año."],
    ["starter", "monthly", "14 días gratis, luego $19 al mes."],
    ["starter", "yearly", "14 días gratis, luego $190 al año."],
    ["pro", "monthly", "14 días gratis, luego $89 al mes."],
    ["pro", "yearly", "14 días gratis, luego $890 al año."],
  ] as const)("states the %s %s price, renewal and deadline in Spanish", (planId, cycle, opening) => {
    const text = disclosure("es", planId, cycle, true);
    expect(text.startsWith(opening)).toBe(true);
    expect(text).toContain("Se renueva automáticamente hasta que canceles.");
    expect(text).toContain("antes del 20 de octubre de 2026 y no se te cobrará.");
  });

  it("drops the trial and the date when the account already used its trial", () => {
    expect(disclosure("en", "basic", "monthly", false)).toBe(
      "$5/month, starting today. Renews automatically until you cancel. Cancel anytime in Billing to stop the next charge.",
    );
    expect(disclosure("es", "pro", "yearly", false)).toContain("$890 al año, desde hoy.");
  });

  it("never prints a deadline later than the real one in any time zone", () => {
    // 23:30 UTC: already the 21st in Asia, still the 20th in UTC−12.
    const late = new Date("2026-10-06T23:30:00Z");
    expect(planTrialEnd(late).toISOString()).toBe("2026-10-20T23:30:00.000Z");
    expect(formatTrialDate(planTrialEnd(late), "en")).toBe("October 20, 2026");
  });
});

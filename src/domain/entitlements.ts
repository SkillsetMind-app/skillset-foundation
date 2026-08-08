/**
 * Plan entitlements — what each tier includes, and how much of it.
 *
 * Until now the plan changed ONE thing: the commission rate (see
 * `src/data/plans.ts`). Every feature was on every tier. This module is the
 * first feature differentiation, and it is deliberately shaped like an AI
 * subscription: a flat monthly price buys a QUOTA, the teacher sees the number
 * up front, and when they outgrow it they ask for more instead of being cut off
 * at a paywall.
 *
 * Two rules that keep this honest:
 *
 * 1. `null` means unlimited, `0` means the feature is off for that tier. Never
 *    use -1 or Infinity — they serialize badly and read as bugs.
 *
 * 2. THE DATABASE IS THE ENFORCEMENT POINT, not this file. Anything a teacher
 *    could bypass by editing a request is checked again in SQL (see
 *    `set_course_featured_self_serve`). The numbers here drive the UI: showing
 *    "3 of 5 used" before the click, and a useful error after it. If the two
 *    ever drift, SQL wins and the teacher sees the server's message.
 *
 * Live-session minutes are counted in ATTENDEE-minutes, not class minutes.
 * A 60-minute class with 25 students spends 1,500. This matters: broadcast
 * delivery is billed per delivered minute (Cloudflare Stream, $1 per 1,000),
 * so a quota denominated in class-minutes would let one teacher with 500
 * viewers cost more than the whole tier collects. `liveSessionExample` carries
 * the plain-language translation the teacher actually reads.
 */

import type { PlanId } from "@/data/plans";

export type QuotaKey =
  | "publishedProducts"
  | "activeStudents"
  | "liveAttendeeMinutesPerMonth"
  | "videoStorageMinutes"
  | "featuredSlots"
  | "activeCoupons"
  | "customDomains"
  | "teamSeats"
  | "emailSendsPerMonth";

export type FeatureKey =
  | "removePlatformBranding"
  | "certificateOwnLogo"
  | "storefrontTemplates";

/** `null` = unlimited. `0` = not included on this tier. */
export type QuotaLimit = number | null;

export type PlanEntitlements = {
  quotas: Record<QuotaKey, QuotaLimit>;
  features: Record<FeatureKey, boolean>;
  /** Plain-language translation of the live quota, shown next to the number. */
  liveSessionExample: string;
};

export const planEntitlements: Record<PlanId, PlanEntitlements> = {
  free: {
    quotas: {
      publishedProducts: 1,
      activeStudents: 50,
      liveAttendeeMinutesPerMonth: 0,
      videoStorageMinutes: 60,
      featuredSlots: 0,
      activeCoupons: 3,
      customDomains: 0,
      teamSeats: 1,
      emailSendsPerMonth: 0,
    },
    features: {
      removePlatformBranding: false,
      certificateOwnLogo: false,
      storefrontTemplates: false,
    },
    liveSessionExample: "Live sessions are not included on Free.",
  },
  starter: {
    quotas: {
      publishedProducts: 5,
      activeStudents: 300,
      liveAttendeeMinutesPerMonth: 5_000,
      videoStorageMinutes: 600,
      featuredSlots: 1,
      activeCoupons: 20,
      customDomains: 0,
      teamSeats: 2,
      emailSendsPerMonth: 2_000,
    },
    features: {
      removePlatformBranding: false,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
    liveSessionExample: "About 5 hours of live class with 15 students.",
  },
  pro: {
    quotas: {
      publishedProducts: 25,
      activeStudents: 2_000,
      liveAttendeeMinutesPerMonth: 30_000,
      videoStorageMinutes: 3_000,
      featuredSlots: 3,
      activeCoupons: 100,
      customDomains: 1,
      teamSeats: 5,
      emailSendsPerMonth: 10_000,
    },
    features: {
      removePlatformBranding: true,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
    liveSessionExample: "About 20 hours of live class with 25 students.",
  },
  plus: {
    quotas: {
      publishedProducts: null,
      activeStudents: null,
      liveAttendeeMinutesPerMonth: 100_000,
      videoStorageMinutes: 10_000,
      featuredSlots: 5,
      activeCoupons: null,
      customDomains: 3,
      teamSeats: 15,
      emailSendsPerMonth: 50_000,
    },
    features: {
      removePlatformBranding: true,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
    liveSessionExample: "About 40 hours of live class with 40 students.",
  },
};

/**
 * The effective limit for a teacher: the plan default, unless ops granted them
 * an expansion. A grant only ever RAISES a limit — an approved grant lower than
 * the plan default is ignored rather than silently downgrading someone who
 * upgraded their plan after asking for more.
 *
 * `null` (unlimited) beats any number, so a grant cannot cap an unlimited plan.
 */
export function effectiveLimit(
  planId: PlanId,
  key: QuotaKey,
  grantedLimit?: QuotaLimit | undefined,
): QuotaLimit {
  const base = planEntitlements[planId].quotas[key];
  if (base === null) return null;
  if (grantedLimit === null) return null;
  if (typeof grantedLimit !== "number" || !Number.isFinite(grantedLimit)) {
    return base;
  }
  return Math.max(base, Math.floor(grantedLimit));
}

export type QuotaStatus = {
  used: number;
  limit: QuotaLimit;
  remaining: number | null;
  /** Can the teacher consume one more right now? */
  canConsume: boolean;
  /** True once the feature is off entirely on this tier (limit 0). */
  lockedOnPlan: boolean;
  /** 0-1 for progress bars. Always 0 when unlimited — nothing to fill. */
  fraction: number;
};

export function quotaStatus(used: number, limit: QuotaLimit): QuotaStatus {
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0;

  if (limit === null) {
    return {
      used: safeUsed,
      limit: null,
      remaining: null,
      canConsume: true,
      lockedOnPlan: false,
      fraction: 0,
    };
  }

  const remaining = Math.max(0, limit - safeUsed);
  return {
    used: safeUsed,
    limit,
    remaining,
    canConsume: remaining > 0,
    lockedOnPlan: limit === 0,
    fraction: limit === 0 ? 1 : Math.min(1, safeUsed / limit),
  };
}

export function hasFeature(planId: PlanId, key: FeatureKey): boolean {
  return planEntitlements[planId].features[key];
}

/** The cheapest plan that includes a feature — powers "Upgrade to Pro" copy. */
export function lowestPlanWithFeature(key: FeatureKey): PlanId | null {
  const order: PlanId[] = ["free", "starter", "pro", "plus"];
  return order.find((planId) => hasFeature(planId, key)) ?? null;
}

/** The cheapest plan whose quota covers `needed`. Null when none does. */
export function lowestPlanWithQuota(
  key: QuotaKey,
  needed: number,
): PlanId | null {
  const order: PlanId[] = ["free", "starter", "pro", "plus"];
  return (
    order.find((planId) => {
      const limit = planEntitlements[planId].quotas[key];
      return limit === null || limit >= needed;
    }) ?? null
  );
}

export const quotaLabels: Record<QuotaKey, string> = {
  publishedProducts: "Published products",
  activeStudents: "Active students",
  liveAttendeeMinutesPerMonth: "Live minutes per month",
  videoStorageMinutes: "Video storage",
  featuredSlots: "Marketplace highlights",
  activeCoupons: "Active coupons",
  customDomains: "Custom domains",
  teamSeats: "Team seats",
  emailSendsPerMonth: "Email sends per month",
};

export function formatLimit(limit: QuotaLimit): string {
  if (limit === null) return "Unlimited";
  if (limit === 0) return "Not included";
  return limit.toLocaleString("en-US");
}

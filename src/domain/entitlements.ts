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
 * No live-session quota here on purpose. Live classes already ship as a link
 * the teacher owns (`CourseEvent.externalUrl` — they paste their own Zoom or
 * Meet room), which costs us nothing and stays unlimited on every tier. A
 * platform-hosted room is the paid, metered half of that split and is not
 * built yet; when it is, it gets three readable knobs — classes per month, max
 * duration, max room size — not the attendee-minute bucket this file used to
 * carry. See docs/plans/2026-08-08-plano-mestre-recursos-por-plano.md.
 *
 * No bandwidth quota either — and unlike the live-session gap, that one has a
 * cost ceiling worth knowing. `videoStorageMinutes` caps the cheap resource
 * ($2/month of Bunny storage at the largest tier); the expensive one is hours
 * WATCHED, at ~$0.0066/hour on the Volume network. Pro turns unprofitable past
 * roughly 640 students completing its catalog, and `activeStudents: null` on
 * Plus puts no ceiling on it at all. Deliberately unmetered for now: Bunny is
 * not serving production video yet. D23 in DECISIONS.md carries the math and
 * the trigger for building the meter.
 */

import type { PlanId } from "@/data/plans";

/**
 * Coupons are deliberately NOT a quota (decision, Patrick, 2026-08-08:
 * "independente do plano/assinatura"). A coupon costs us nothing to store and
 * only fires when it produces a sale we take a fee on — capping it taxes the
 * teacher for trying to sell. Every plan, including free, creates as many as
 * it wants. Don't reintroduce `activeCoupons`.
 */
export type QuotaKey =
  | "publishedProducts"
  | "activeStudents"
  | "videoStorageMinutes"
  | "featuredSlots"
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
};

export const planEntitlements: Record<PlanId, PlanEntitlements> = {
  free: {
    quotas: {
      publishedProducts: 1,
      activeStudents: 50,
      videoStorageMinutes: 60,
      featuredSlots: 0,
      customDomains: 0,
      teamSeats: 1,
      emailSendsPerMonth: 0,
    },
    features: {
      removePlatformBranding: false,
      certificateOwnLogo: false,
      storefrontTemplates: false,
    },
  },
  starter: {
    quotas: {
      publishedProducts: 5,
      activeStudents: 300,
      videoStorageMinutes: 600,
      featuredSlots: 1,
      customDomains: 0,
      teamSeats: 2,
      emailSendsPerMonth: 2_000,
    },
    features: {
      removePlatformBranding: false,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
  },
  pro: {
    quotas: {
      publishedProducts: 25,
      activeStudents: 2_000,
      videoStorageMinutes: 3_000,
      featuredSlots: 3,
      customDomains: 1,
      teamSeats: 5,
      emailSendsPerMonth: 10_000,
    },
    features: {
      removePlatformBranding: true,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
  },
  plus: {
    quotas: {
      publishedProducts: null,
      activeStudents: null,
      videoStorageMinutes: 10_000,
      featuredSlots: 5,
      customDomains: 3,
      teamSeats: 15,
      emailSendsPerMonth: 50_000,
    },
    features: {
      removePlatformBranding: true,
      certificateOwnLogo: true,
      storefrontTemplates: true,
    },
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
  videoStorageMinutes: "Video storage",
  featuredSlots: "Marketplace highlights",
  customDomains: "Custom domains",
  teamSeats: "Team seats",
  emailSendsPerMonth: "Email sends per month",
};

export function formatLimit(limit: QuotaLimit): string {
  if (limit === null) return "Unlimited";
  if (limit === 0) return "Not included";
  return limit.toLocaleString("en-US");
}

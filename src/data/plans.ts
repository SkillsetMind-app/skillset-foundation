/**
 * SkillsetMind pricing model — single source of truth.
 *
 * The public offer is two paid tiers, Starter and Pro (`publicPlans`), each
 * opening with a 14-day free trial (card required, one per creator account).
 * `free` stays in code as the internal default for accounts with no
 * subscription: it still publishes and sells at 10% until enforcement ships,
 * and it keeps its daily caps (video uploads, advisor, manual access —
 * enforced in their routes by plan, via isOnFreePlan). `plus` is retired:
 * closed to new subscribers, kept here so existing Plus subscriptions resolve
 * with the same limits. A paid plan lowers the commission SkillsetMind takes
 * per paid sale and adds the extras in domain/entitlements.ts.
 * Charges are Stripe DIRECT charges on the
 * creator's own connected account: the creator is the merchant of record,
 * Stripe bills them the processing fee, and SkillsetMind takes its commission
 * as `application_fee_amount` at charge time. The platform never holds a
 * balance for the creator, so there is no PLATFORM clearing period; Stripe
 * still applies its own settlement and payout timing on the creator's
 * connected account, which the platform does not control and cannot waive.
 *
 * There is no activation fee. A one-time fee at the first publish still exists
 * in code, dormant: ONE switch, the `require_activation_fee` row in
 * platform_settings (false), read only through creator_activation_blocked().
 * Off, that predicate is false for everyone, so publish, coupons, manual access,
 * custom domains, the advisor and the studio UI are open, /teach/activate
 * redirects to /teach and the checkout route answers 409. Public pages and the
 * Teacher Terms do not mention a fee at all; turning it back on means writing
 * that disclosure again, not just flipping the row.
 *
 * If the user upgrades or downgrades, sales BEFORE the change keep the
 * commission rate from `plan_at_time_of_sale` (snapshot in the transactions
 * table). New sales after the change use the new rate.
 */

export type PlanId = "free" | "starter" | "pro" | "plus";

export type PlanBillingCycle = "monthly" | "yearly";

/**
 * Stripe Price IDs for the paid plans. Create the Prices in Stripe
 * Dashboard (Product catalog → SkillsetMind {Plan} → recurring monthly/yearly
 * in USD) and replace the PLACEHOLDER strings with the real `price_...`
 * IDs. The Free plan has no Stripe Price — its presence is implicit
 * (no active subscription → on Free).
 *
 * The runtime guard `hasRealStripePriceIds` lets the UI render an
 * informative "billing not configured yet" state when placeholders
 * still ship, so the upgrade buttons fail loudly instead of producing
 * a confusing Stripe error.
 */
export type StripePriceIds = {
  monthlyId: string;
  yearlyId: string;
};

export type Plan = {
  id: PlanId;
  name: string;
  /** Subscription price billed monthly, in USD. Zero on Free. */
  monthlyUsd: number;
  /** Subscription price billed yearly, in USD. Reflects the annual discount. */
  yearlyUsd: number;
  /** Commission rate per paid sale, as a percent (e.g. 10 = 10%). */
  commissionPercent: number;
  /** Stripe Price IDs for monthly and yearly cycles. Null on Free. */
  stripePriceIds: StripePriceIds | null;
  /** One-line positioning tagline. */
  tagline: string;
  /** Who this plan is for. Never an income band: public copy makes no earnings claims. */
  audience: string;
  /** Headline bullets shown on the pricing page. */
  highlights: ReadonlyArray<string>;
  /**
   * Closed to new subscribers: hidden from every offer, selector and upgrade
   * flow, but existing subscriptions keep resolving to this plan.
   */
  retired?: boolean;
  /**
   * Older Prices that existing subscriptions may still sit on. They resolve
   * to this plan (same limits, same commission) until moved to the current
   * Price by scripts/plan-repricing.mjs.
   */
  legacyStripePriceIds?: ReadonlyArray<StripePriceIds>;
};

/** Placeholder marker — the runtime treats any Price ID starting with
 * this prefix as "not configured yet" and surfaces a clear error. */
export const STRIPE_PRICE_PLACEHOLDER_PREFIX = "price_PLACEHOLDER_";

/** Free-trial length on the first paid plan of a creator account. */
export const PLAN_TRIAL_DAYS = 14;

/**
 * Subscription statuses that grant the plan. `trialing` is the plan working in
 * full — limits and the lower commission — before the first charge.
 */
export const PLAN_ENTITLED_STATUSES = ["active", "trialing"] as const;

export function isPlanEntitledStatus(status: string | null | undefined): boolean {
  return (PLAN_ENTITLED_STATUSES as ReadonlyArray<string>).includes(String(status));
}

export const plans: ReadonlyArray<Plan> = [
  {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    yearlyUsd: 0,
    commissionPercent: 10,
    stripePriceIds: null,
    tagline: "The default for accounts without a plan.",
    audience: "New creators validating an idea.",
    highlights: [
      "No monthly fee — commission only when you sell",
      "Publish once your course passes the launch checks",
      "Stripe checkout in 30 currencies",
      "Buyers pay your own Stripe account — no platform hold on your money",
      "SkillsetMind Verified certificates",
      "Course communities and live sessions",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    monthlyUsd: 5,
    yearlyUsd: 50,
    commissionPercent: 4.9,
    // $5/month and $50/year, lookup keys skillset_starter_monthly_2026_10 and
    // skillset_starter_yearly_2026_10. Replace the placeholders with the real
    // `price_...` IDs once they exist in Stripe (see the PR's Stripe steps).
    stripePriceIds: {
      monthlyId: "price_PLACEHOLDER_starter_monthly_5",
      yearlyId: "price_PLACEHOLDER_starter_yearly_50",
    },
    // The $19/$190 Prices. Existing subscriptions still resolve to Starter.
    legacyStripePriceIds: [
      {
        monthlyId: "price_1TZFTmPvg1vJW0IjLAYWqZok",
        yearlyId: "price_1TZFTnPvg1vJW0IjjaQXBpDW",
      },
    ],
    tagline: "A low monthly price and a 4.9% commission.",
    audience: "Creators starting to sell.",
    highlights: [
      "4.9% commission per sale",
      // Enforced in SQL (claim_custom_domain, set_own_course_featured). Student
      // and product counts are not enforced, so no public line sells them.
      "1 custom domain and 1 marketplace highlight",
      "Annual billing saves ~17%",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyUsd: 89,
    yearlyUsd: 890,
    commissionPercent: 0,
    stripePriceIds: {
      monthlyId: "price_1TZFTnPvg1vJW0IjHYe4yW9V",
      yearlyId: "price_1TZFToPvg1vJW0IjDHGPIzH0",
    },
    tagline: "0% commission on your sales.",
    audience: "Creators with an established catalog.",
    highlights: [
      "0% commission per sale",
      "5 custom domains and 5 marketplace highlights",
      "Remove the SkillsetMind mark",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    monthlyUsd: 199,
    yearlyUsd: 1990,
    commissionPercent: 2,
    stripePriceIds: {
      monthlyId: "price_1TZFToPvg1vJW0Ijf35SQQzt",
      yearlyId: "price_1TZFTpPvg1vJW0IjgE9PQ5To",
    },
    tagline: "The lowest commission for high-volume creators.",
    audience: "Creators with a large catalog and steady sales.",
    highlights: [
      "Everything in Pro",
      "Lowest commission — 2% per sale",
    ],
    retired: true,
  },
];

/** What the pricing page, plan selectors and upgrade flows offer. */
export const publicPlans: ReadonlyArray<Plan> = plans.filter(
  (plan) => plan.id !== "free" && !plan.retired,
);

/** The plan the pricing page badges "Recommended". Never "Most popular". */
export const RECOMMENDED_PLAN_ID: PlanId = "starter";

export function isPublicPlanId(id: unknown): id is Exclude<PlanId, "free"> {
  return publicPlans.some((plan) => plan.id === id);
}

export function isPlaceholderStripePriceId(id: string): boolean {
  return id.startsWith(STRIPE_PRICE_PLACEHOLDER_PREFIX);
}

export function hasRealStripePriceIds(plan: Plan): boolean {
  if (!plan.stripePriceIds) return false;
  return (
    !isPlaceholderStripePriceId(plan.stripePriceIds.monthlyId) &&
    !isPlaceholderStripePriceId(plan.stripePriceIds.yearlyId)
  );
}

/** Are the plans on offer configured with real Stripe Price IDs? */
export function isBillingConfigured(): boolean {
  return publicPlans.every(hasRealStripePriceIds);
}

/** Plan and cycle of a Price, current or legacy. Undefined for unknown Prices. */
export function planAndCycleByStripePriceId(
  priceId: string,
): { plan: Plan; cycle: PlanBillingCycle } | undefined {
  for (const plan of plans) {
    for (const ids of [plan.stripePriceIds, ...(plan.legacyStripePriceIds ?? [])]) {
      if (ids?.monthlyId === priceId) return { plan, cycle: "monthly" };
      if (ids?.yearlyId === priceId) return { plan, cycle: "yearly" };
    }
  }
  return undefined;
}

export function planByStripePriceId(priceId: string): Plan | undefined {
  return planAndCycleByStripePriceId(priceId)?.plan;
}

/**
 * Dormant one-time activation fee, in USD — charged only while
 * `require_activation_fee` is on (see the header). Not a subscription, not
 * per-course, never charged again.
 */
export const activationFeeUsd = 25;

/**
 * Stripe Price ID for the activation fee — a LIVE one-time $25 USD price on
 * product `prod_UyzTYPDBp4hnlk`, created by `scripts/create-activation-price.mjs`
 * (idempotent via lookup_key `skillset_storefront_activation_one_time`; re-run it to recreate
 * the price in another Stripe account rather than clicking through the Dashboard).
 *
 * If this ever reverts to a placeholder, `isActivationFeeConfigured()` goes false
 * and the checkout route answers 503 instead of a confusing Stripe error — and
 * `require_activation_fee` must stay false in platform_settings, or the gate would
 * block every publish with no way to pay.
 */
export const ACTIVATION_FEE_STRIPE_PRICE_ID = "price_1Tz1UvPvg1vJW0IjxFX7Nppi";

export function isActivationFeeConfigured(): boolean {
  return !isPlaceholderStripePriceId(ACTIVATION_FEE_STRIPE_PRICE_ID);
}

/**
 * Checkout metadata discriminator for the activation fee. The Stripe webhook
 * routes `checkout.session.completed` on this value, so the checkout route and
 * the webhook MUST read it from here — a literal typed twice would silently send
 * activation payments into the course-fulfilment path. It lives in this module
 * rather than in the route file because Next.js App Router rejects non-handler
 * exports from `route.ts`.
 */
export const ACTIVATION_FEE_CHECKOUT_PURPOSE = "skillset_activation_fee";

export function planById(id: PlanId): Plan {
  const plan = plans.find((candidate) => candidate.id === id);
  if (!plan) {
    throw new Error(`Unknown plan id: ${id}`);
  }
  return plan;
}

/**
 * Refund window in days. A learner who has not crossed the progress /
 * certificate thresholds can self-refund within this window from the
 * order's `sale_at`. After the window, refunds are admin-only.
 */
export const refundWindowDays = 7;


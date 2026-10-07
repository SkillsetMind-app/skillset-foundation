/**
 * SkillsetMind pricing model — single source of truth.
 *
 * The public offer is three paid tiers, Basic, Starter and Pro (`publicPlans`),
 * each opening with a 14-day free trial (card required, one per creator
 * account). Every sale pays the plan's percent PLUS a fixed fee of about
 * US$0.30 (`platformFixedFeeMinor` in lib/payments/rules.ts). Enterprise (id
 * `plus`, kept so existing subscriptions resolve) is not on the public offer.
 * `free` is no longer offered either: it stays in code only as the state of
 * an account with no subscription, at Basic's rate and limits, with its daily
 * caps (video uploads, advisor, manual access — enforced in their routes via
 * isOnFreePlan), until the enforcement change blocks selling without a plan.
 * A higher plan lowers the commission SkillsetMind takes per paid sale and
 * adds the extras in domain/entitlements.ts.
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

export type PlanId = "free" | "basic" | "starter" | "pro" | "plus";

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
   * Not on the public offer: hidden from the pricing page, selectors and
   * upgrade flows, never sold through self-serve checkout. Subscriptions that
   * exist (or that ops set up by hand) still resolve to this plan.
   */
  hidden?: boolean;
};

/**
 * The fixed part of the per-sale fee, in USD, for copy ("4.9% + $0.30"). The
 * amount actually charged in each currency is platformFixedFeeMinor().
 */
export const PER_SALE_FIXED_FEE_USD = 0.3;

/** Placeholder marker — the runtime treats any Price ID starting with
 * this prefix as "not configured yet" and surfaces a clear error. */
export const STRIPE_PRICE_PLACEHOLDER_PREFIX = "price_PLACEHOLDER_";

/**
 * Stripe Customer Portal configuration (`bpc_...`) every portal session uses:
 * plan switching only between Basic, Starter and Pro, cancellation at the end
 * of the period. Passed explicitly so the Dashboard's default configuration,
 * which can still list Enterprise, is never what a creator sees. Until the
 * real id is pasted here the portal route answers 503 instead of opening the
 * default (see resolvePortalConfigurationId).
 */
export const STRIPE_PORTAL_CONFIGURATION_ID = "bpc_PLACEHOLDER_basic_starter_pro";

/**
 * Enterprise (`plus`) is never self-serve. Ops create the subscription in the
 * Stripe Dashboard and set this metadata on it; the webhook grants Enterprise
 * only then. A customer cannot set subscription metadata (neither Checkout nor
 * the portal lets them), so a switch to an Enterprise Price without it grants
 * no plan.
 */
export const ENTERPRISE_GRANT_METADATA = { key: "enterprise_grant", value: "admin" } as const;

/**
 * Checkout metadata discriminator for plan subscriptions, written by the plan
 * checkout and read by the webhook (trial acknowledgement email).
 */
export const PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE = "skillset_plan_subscription";

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
    hidden: true,
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
    id: "basic",
    name: "Basic",
    monthlyUsd: 5,
    yearlyUsd: 50,
    commissionPercent: 10,
    // $5/month and $50/year, lookup keys skillset_basic_monthly and
    // skillset_basic_yearly. Replace the placeholders with the real
    // `price_...` IDs once they exist in Stripe (see the PR's Stripe steps).
    stripePriceIds: {
      monthlyId: "price_PLACEHOLDER_basic_monthly_5",
      yearlyId: "price_PLACEHOLDER_basic_yearly_50",
    },
    tagline: "Start selling for a small monthly price.",
    audience: "Creators validating their first course.",
    highlights: [
      "10% + $0.30 per sale",
      "Publish once your course passes the launch checks",
      "Annual billing saves ~17%",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    monthlyUsd: 19,
    yearlyUsd: 190,
    commissionPercent: 4.9,
    stripePriceIds: {
      monthlyId: "price_1TZFTmPvg1vJW0IjLAYWqZok",
      yearlyId: "price_1TZFTnPvg1vJW0IjjaQXBpDW",
    },
    tagline: "A lower commission once you sell every month.",
    audience: "Creators who sell every month.",
    highlights: [
      "4.9% + $0.30 per sale",
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
    commissionPercent: 2.9,
    stripePriceIds: {
      monthlyId: "price_1TZFTnPvg1vJW0IjHYe4yW9V",
      yearlyId: "price_1TZFToPvg1vJW0IjDHGPIzH0",
    },
    tagline: "The lowest commission on the offer.",
    audience: "Creators with an established catalog.",
    highlights: [
      "2.9% + $0.30 per sale",
      "5 custom domains and 5 marketplace highlights",
      "Remove the SkillsetMind mark",
    ],
  },
  {
    // Enterprise. The id stays `plus`: it is the old Plus slot, its Stripe
    // Prices and every users.current_plan_id that already says so.
    id: "plus",
    name: "Enterprise",
    monthlyUsd: 199,
    yearlyUsd: 1990,
    commissionPercent: 1.9,
    stripePriceIds: {
      monthlyId: "price_1TZFToPvg1vJW0Ijf35SQQzt",
      yearlyId: "price_1TZFTpPvg1vJW0IjgE9PQ5To",
    },
    tagline: "For catalogs above Pro's limits, by arrangement.",
    audience: "Creators with a large catalog and steady sales.",
    highlights: [
      "1.9% + $0.30 per sale",
      "No cap on active students",
    ],
    hidden: true,
  },
];

/** What the pricing page, plan selectors and upgrade flows offer. */
export const publicPlans: ReadonlyArray<Plan> = plans.filter((plan) => !plan.hidden);

/** "4.9% + $0.30": the plan's percent and the fixed part, as copy shows them. */
export function formatPlanCommission(plan: Plan): string {
  return `${plan.commissionPercent}% + $${PER_SALE_FIXED_FEE_USD.toFixed(2)}`;
}

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

export function hasRealPortalConfigurationId(id: string): boolean {
  return !id.includes("PLACEHOLDER");
}

/** Real Stripe Price IDs and a real portal configuration, or "Manage" is a dead button. */
export function isBillingConfigured(): boolean {
  return publicPlans.every(hasRealStripePriceIds) && hasRealPortalConfigurationId(STRIPE_PORTAL_CONFIGURATION_ID);
}

/** Plan and cycle of a Price. Undefined for unknown Prices. */
export function planAndCycleByStripePriceId(
  priceId: string,
): { plan: Plan; cycle: PlanBillingCycle } | undefined {
  for (const plan of plans) {
    if (plan.stripePriceIds?.monthlyId === priceId) return { plan, cycle: "monthly" };
    if (plan.stripePriceIds?.yearlyId === priceId) return { plan, cycle: "yearly" };
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


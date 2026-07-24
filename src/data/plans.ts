/**
 * SkillsetMind pricing model — single source of truth.
 *
 * Four tiers. Every feature is available on every tier; the plan only
 * changes the commission rate SkillsetMind takes per paid sale and adds an
 * optional monthly subscription. Stripe processing fee is passed through
 * to the creator on every sale, regardless of plan (see DECISIONS.md D2
 * and src/domain/payment-split.ts).
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
  /** Who this plan is for. */
  audience: string;
  /**
   * Approximate monthly GMV (in USD) where moving UP to this plan becomes
   * cheaper than staying on the cheaper plan. Computed from:
   *   (delta_subscription) / (delta_commission_rate)
   * Free → Starter: $19 / (0.10 - 0.05) = $380 GMV
   * Starter → Pro:  ($89 - $19) / (0.05 - 0.03) = $3,500 GMV
   * Pro → Plus:     ($199 - $89) / (0.03 - 0.02) = $11,000 GMV
   * Null on Free (no plan beneath it to compare against).
   */
  breakEvenGmvUsd: number | null;
  /** Headline bullets shown on the pricing page. */
  highlights: ReadonlyArray<string>;
};

/** Placeholder marker — the runtime treats any Price ID starting with
 * this prefix as "not configured yet" and surfaces a clear error. */
export const STRIPE_PRICE_PLACEHOLDER_PREFIX = "price_PLACEHOLDER_";

export const plans: ReadonlyArray<Plan> = [
  {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    yearlyUsd: 0,
    commissionPercent: 10,
    stripePriceIds: null,
    tagline: "Start selling without a subscription.",
    audience: "New creators validating an idea.",
    breakEvenGmvUsd: null,
    highlights: [
      "Every SkillsetMind feature — no tier locks",
      "Publish and sell immediately",
      "Stripe checkout in 30+ currencies",
      "SkillsetMind Verified certificates",
      "Course communities and live sessions",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    monthlyUsd: 19,
    yearlyUsd: 190,
    commissionPercent: 5,
    stripePriceIds: {
      monthlyId: "price_1TZFTmPvg1vJW0IjLAYWqZok",
      yearlyId: "price_1TZFTnPvg1vJW0IjjaQXBpDW",
    },
    tagline: "Half the commission, small monthly cost.",
    audience: "Creators earning around $400–$3,500 a month.",
    breakEvenGmvUsd: 380,
    highlights: [
      "Everything in Free",
      "Commission drops from 10% to 5%",
      "Annual billing saves ~17%",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyUsd: 89,
    yearlyUsd: 890,
    commissionPercent: 3,
    stripePriceIds: {
      monthlyId: "price_1TZFTnPvg1vJW0IjHYe4yW9V",
      yearlyId: "price_1TZFToPvg1vJW0IjDHGPIzH0",
    },
    tagline: "A lower commission for established catalogs.",
    audience: "Creators earning around $3,500–$11,000 a month.",
    breakEvenGmvUsd: 3500,
    highlights: [
      "Everything in Starter",
      "Commission drops to 3%",
      "Priority human support",
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
    audience: "Creators earning $11,000 a month and up.",
    breakEvenGmvUsd: 11000,
    highlights: [
      "Everything in Pro",
      "Lowest commission — 2% per sale",
      "Dedicated launch reviews",
    ],
  },
];

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

/** Are at least the paid plans configured with real Stripe Price IDs? */
export function isBillingConfigured(): boolean {
  return plans.filter((plan) => plan.id !== "free").every(hasRealStripePriceIds);
}

export function planByStripePriceId(priceId: string): Plan | undefined {
  return plans.find(
    (plan) =>
      plan.stripePriceIds?.monthlyId === priceId ||
      plan.stripePriceIds?.yearlyId === priceId,
  );
}

/** Default plan for any account without an active subscription. */
export const defaultPlanId: PlanId = "free";

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


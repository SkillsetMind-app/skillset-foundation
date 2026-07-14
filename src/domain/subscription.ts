import type { PlanBillingCycle, PlanId } from "@/data/plans";

/**
 * Subscription state mirrored from Stripe. Updated by the
 * customer.subscription.* webhook handlers. The `userId` is the
 * Firebase Auth uid; the `stripeSubscriptionId` is the Stripe-side
 * key used for idempotency and Customer Portal handoffs.
 */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type Subscription = {
  /** Firebase Auth uid of the owner. */
  userId: string;
  /** Which SkillsetMind plan this subscription corresponds to. */
  planId: PlanId;
  /** Billing cycle this subscription was started on. */
  cycle: PlanBillingCycle;
  /** Stripe-side identifiers (kept for webhook reconciliation + portal). */
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  /** Mirrors the Stripe subscription status, lower-cased. */
  status: SubscriptionStatus;
  /** Current period boundaries as ISO strings (Stripe sends seconds). */
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** True when the user requested cancel-at-period-end via the Portal. */
  cancelAtPeriodEnd: boolean;
  /** ISO timestamp of last webhook event applied. */
  updatedAt: string;
};

/** True when the subscription should grant the plan's benefits today. */
export function isSubscriptionEntitled(
  subscription: Pick<Subscription, "status">,
): boolean {
  return subscription.status === "active" || subscription.status === "trialing";
}

/**
 * Resolves the plan-id a user should be billed at right now.
 * Falls back to "free" if there is no entitled subscription. Snapshot
 * this on every sale so historical commission math is preserved.
 */
export function resolveEffectivePlanId(
  subscription: Pick<Subscription, "planId" | "status"> | null | undefined,
): PlanId {
  if (subscription && isSubscriptionEntitled(subscription)) {
    return subscription.planId;
  }
  return "free";
}

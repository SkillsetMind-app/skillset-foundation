"use client";

import type { PlanBillingCycle, PlanId } from "@/data/plans";
import { postPaymentRoute } from "@/lib/payments/client-fetch";

type CreateBillingCheckoutResult = {
  /** Stripe Checkout Session client_secret for embedded mode. */
  clientSecret: string;
  /** Stripe Checkout Session id (useful for diagnostics + status polling). */
  sessionId: string;
  /** 14 when this checkout opens a free trial, 0 when it starts paid. */
  trialDays: number;
};

/**
 * Creates a Stripe Checkout Session for upgrading to a paid plan and
 * returns the `clientSecret` needed to mount the embedded checkout UI.
 * The Route Handler resolves the Stripe Price ID from plans.ts so the
 * client never has to know it.
 *
 * The UI then renders `<EmbeddedCheckoutProvider clientSecret={...}>`
 * — the learner stays on SkillsetMind, the card form is Stripe Elements
 * inside our page (PCI-compliant, no redirect).
 */
export async function createBillingCheckoutClientSecret(
  planId: Exclude<PlanId, "free">,
  cycle: PlanBillingCycle,
): Promise<CreateBillingCheckoutResult> {
  const result = await postPaymentRoute<CreateBillingCheckoutResult>(
    "/api/payments/billing/checkout",
    { planId, cycle },
  );

  if (!result.clientSecret) {
    throw new Error("Stripe did not return a client_secret.");
  }

  return result;
}

/**
 * Whether the Stripe publishable key is present in this build. Embedded
 * checkout needs it to mount Stripe.js on the client; without it the upgrade
 * flow can only show a "checkout not configured" notice. Exposed so the plans
 * UI can present an honest, non-dead-end state (disabled buttons + explainer)
 * instead of letting a user click into a checkout that can't load — and it
 * flips on automatically once the key is added and the app is redeployed.
 *
 * `NEXT_PUBLIC_*` is inlined by Next at build time, so this resolves to a
 * static boolean in the client bundle.
 */
export function isCheckoutClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

/**
 * Opens the Stripe Customer Portal so the user can update card, change
 * plan, cancel, or download invoices. The Portal is a Stripe-hosted page
 * (no embedded option exists for it today). Used for managing an
 * EXISTING subscription, not for the upgrade conversion flow — that
 * stays embedded via the function above.
 */
export async function openBillingPortal() {
  const { url } = await postPaymentRoute<{ url: string }>(
    "/api/payments/billing/portal",
  );

  if (!url) {
    throw new Error("Stripe did not return a Customer Portal URL.");
  }

  window.location.assign(url);
}

export type PlanSubscriptionView = {
  planId: PlanId | null;
  cycle: PlanBillingCycle | null;
  status: string;
  /** ISO date while trialing; null otherwise. */
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type PlanBillingState = {
  /** No trial used on this account yet: the first paid plan opens with one. */
  trialEligible: boolean;
  subscription: PlanSubscriptionView | null;
};

/** Trial eligibility and the live plan subscription, for the Billing page. */
export async function fetchPlanBillingState(): Promise<PlanBillingState> {
  const response = await fetch("/api/payments/billing/subscription");
  if (!response.ok) {
    throw new Error(`Plan billing state answered ${response.status}.`);
  }
  return (await response.json()) as PlanBillingState;
}

/** "Cancel plan": ends at the current period's end; during a trial, nothing is charged. */
export async function cancelPlanSubscription(): Promise<PlanSubscriptionView | null> {
  const { subscription } = await postPaymentRoute<{ subscription: PlanSubscriptionView | null }>(
    "/api/payments/billing/subscription",
  );
  return subscription;
}

/**
 * Requests a self-serve refund for a paid course purchase. The Route Handler is
 * keyed by enrollmentId — which is deterministic, `${uid}__${courseId}` — and
 * enforces the real policy gates (refund window, course progress, certificate
 * status). It rejects ineligible requests with an error message we surface
 * verbatim, so the UI never has to encode the policy itself.
 */
export async function requestOrderRefund(enrollmentId: string): Promise<void> {
  await postPaymentRoute("/api/payments/refunds/request", { enrollmentId });
}

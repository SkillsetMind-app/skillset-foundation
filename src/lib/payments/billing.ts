"use client";

import { httpsCallable } from "firebase/functions";

import type { PlanBillingCycle, PlanId } from "@/data/plans";
import { getFirebaseFunctions } from "@/lib/firebase/client";

type CreateBillingCheckoutInput = {
  planId: Exclude<PlanId, "free">;
  cycle: PlanBillingCycle;
};

type CreateBillingCheckoutResult = {
  /** Stripe Checkout Session client_secret for embedded mode. */
  clientSecret: string;
  /** Stripe Checkout Session id (useful for diagnostics + status polling). */
  sessionId: string;
};

type CreateBillingPortalResult = {
  url: string;
};

/**
 * Creates a Stripe Checkout Session for upgrading to a paid plan and
 * returns the `clientSecret` needed to mount the embedded checkout UI.
 * The server-side function resolves the Stripe Price ID from plans.ts
 * so the client never has to know it.
 *
 * The UI then renders `<EmbeddedCheckoutProvider clientSecret={...}>`
 * — the learner stays on Skillset, the card form is Stripe Elements
 * inside our page (PCI-compliant, no redirect).
 */
export async function createBillingCheckoutClientSecret(
  planId: Exclude<PlanId, "free">,
  cycle: PlanBillingCycle,
): Promise<CreateBillingCheckoutResult> {
  const createBillingCheckoutSession = httpsCallable<
    CreateBillingCheckoutInput,
    CreateBillingCheckoutResult
  >(getFirebaseFunctions(), "createBillingCheckoutSession");
  const result = await createBillingCheckoutSession({ planId, cycle });

  if (!result.data.clientSecret) {
    throw new Error("Stripe did not return a client_secret.");
  }

  return result.data;
}

/**
 * Opens the Stripe Customer Portal so the user can update card, change
 * plan, cancel, or download invoices. The Portal is a Stripe-hosted page
 * (no embedded option exists for it today). Used for managing an
 * EXISTING subscription, not for the upgrade conversion flow — that
 * stays embedded via the function above.
 */
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

export async function openBillingPortal() {
  const createBillingPortalSession = httpsCallable<
    Record<string, never>,
    CreateBillingPortalResult
  >(getFirebaseFunctions(), "createBillingPortalSession");
  const result = await createBillingPortalSession({});

  if (!result.data.url) {
    throw new Error("Stripe did not return a Customer Portal URL.");
  }

  window.location.assign(result.data.url);
}

/**
 * Requests a self-serve refund for a paid course purchase. The server callable
 * (`requestRefund`) is keyed by enrollmentId — which is deterministic,
 * `${uid}__${courseId}` — and enforces the real policy gates (refund window,
 * course progress, certificate status). It rejects ineligible requests with an
 * HttpsError whose message we surface verbatim, so the UI never has to encode
 * the policy itself. Resolves on a accepted request; throws otherwise.
 */
export async function requestOrderRefund(enrollmentId: string): Promise<void> {
  const requestRefund = httpsCallable<{ enrollmentId: string }, unknown>(
    getFirebaseFunctions(),
    "requestRefund",
  );
  await requestRefund({ enrollmentId });
}

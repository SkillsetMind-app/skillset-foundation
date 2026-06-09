"use client";

import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "@/lib/firebase/client";

type AccountLinkResult = {
  url: string;
};

type RefreshStripeAccountResult = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status?: "created" | "onboarding_required" | "ready" | "disconnected";
  /**
   * True when the PLATFORM hasn't enabled Stripe Connect yet, so no connected
   * account can be verified or used — distinct from a refresh failure and from
   * the teacher's own onboarding state. UI should show the calm "payouts being
   * configured" state, never an error.
   */
  payoutsUnavailable?: boolean;
};

/**
 * True when a Connect callable failed because the PLATFORM has not enabled
 * Stripe Connect yet (the owner must activate it at dashboard.stripe.com/connect).
 *
 * The backend tags this case with `details.reason === "connect_not_enabled"`
 * (see toStripeHttpsError), which the hosted path receives intact on the
 * FirebaseError. The embedded path goes through Stripe's connect-js, which may
 * rewrap the rejection and drop `details`, so we also message-match the honest
 * server copy and the raw Stripe phrasing as a fallback. Lets the UI show a calm
 * "payouts being configured" panel instead of an alarming error + retry loop.
 */
export function isConnectNotEnabledError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { details?: unknown; message?: unknown };
  const details = candidate.details;
  if (
    details &&
    typeof details === "object" &&
    (details as { reason?: unknown }).reason === "connect_not_enabled"
  ) {
    return true;
  }
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return /signed up for Connect|connect_not_enabled|finishing its Stripe Connect setup|Only Stripe Connect platforms can work/i.test(
    message,
  );
}

export async function startTeacherStripeOnboarding() {
  const createAccountLink = httpsCallable<Record<string, never>, AccountLinkResult>(
    getFirebaseFunctions(),
    "createTeacherStripeAccountLink",
  );
  const result = await createAccountLink({});

  if (!result.data.url) {
    throw new Error("Stripe account onboarding URL missing.");
  }

  window.location.assign(result.data.url);
}

export async function refreshTeacherStripeAccountStatus() {
  const refreshAccount = httpsCallable<
    Record<string, never>,
    RefreshStripeAccountResult
  >(getFirebaseFunctions(), "refreshTeacherStripeAccount");
  const result = await refreshAccount({});

  return result.data;
}

type ConnectAccountSessionResult = {
  clientSecret: string;
  accountId: string;
};

/**
 * Mints a Stripe Connect Account Session client_secret that the embedded
 * onboarding component uses to render KYC / bank / identity flow inside
 * the app. The creator never leaves Skillset.
 */
export async function fetchConnectAccountSessionSecret(): Promise<string> {
  const callable = httpsCallable<
    Record<string, never>,
    ConnectAccountSessionResult
  >(getFirebaseFunctions(), "createConnectAccountSession");
  const result = await callable({});

  if (!result.data.clientSecret) {
    throw new Error("Stripe did not return a Connect Account Session secret.");
  }

  return result.data.clientSecret;
}

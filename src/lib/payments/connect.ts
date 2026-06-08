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
};

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

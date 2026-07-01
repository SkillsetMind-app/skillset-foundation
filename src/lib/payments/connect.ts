"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";

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
 * True when a Connect call failed because the PLATFORM has not enabled Stripe
 * Connect yet (the owner must activate it at dashboard.stripe.com/connect).
 *
 * The Route Handler tags this case as `code: "connect_not_enabled"` on the JSON
 * error body, which PaymentRequestError carries through as `.code` — the primary
 * signal. We also keep the legacy `details.reason` / message fallbacks so an
 * error that reaches the client through Stripe's connect-js (embedded flow, which
 * may rewrap the rejection) is still classified. Lets the UI show a calm "payouts
 * being configured" panel instead of an alarming error + retry loop.
 */
export function isConnectNotEnabledError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    details?: unknown;
    message?: unknown;
  };
  if (candidate.code === "connect_not_enabled") {
    return true;
  }
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
  const { url } = await postPaymentRoute<{ url: string }>(
    "/api/payments/connect/account-link",
  );

  if (!url) {
    throw new Error("Stripe account onboarding URL missing.");
  }

  window.location.assign(url);
}

export async function refreshTeacherStripeAccountStatus() {
  return postPaymentRoute<RefreshStripeAccountResult>(
    "/api/payments/connect/refresh",
  );
}

/**
 * Mints a Stripe Connect Account Session client_secret that the embedded
 * onboarding component uses to render KYC / bank / identity flow inside
 * the app. The creator never leaves Skillset.
 */
export async function fetchConnectAccountSessionSecret(): Promise<string> {
  const { clientSecret } = await postPaymentRoute<{
    clientSecret: string;
    accountId: string;
  }>("/api/payments/connect/account-session");

  if (!clientSecret) {
    throw new Error("Stripe did not return a Connect Account Session secret.");
  }

  return clientSecret;
}

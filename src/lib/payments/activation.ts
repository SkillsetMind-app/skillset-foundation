"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";

type CreateActivationCheckoutResult = {
  /** Stripe Checkout Session client_secret for embedded mode. */
  clientSecret: string;
  /** Stripe Checkout Session id (useful for diagnostics). */
  sessionId: string;
};

/**
 * Creates the Stripe Checkout Session for the one-time storefront activation
 * fee. The Route Handler resolves the Price ID from plans.ts and rejects a
 * creator who already paid, so the client never encodes either rule.
 */
export async function createActivationCheckoutClientSecret(): Promise<CreateActivationCheckoutResult> {
  const result = await postPaymentRoute<CreateActivationCheckoutResult>(
    "/api/payments/activation/checkout",
  );

  if (!result.clientSecret) {
    throw new Error("Stripe did not return a client_secret.");
  }

  return result;
}

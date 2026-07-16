import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";

// Ports createBillingPortalSession: opens the Stripe billing portal for an
// existing subscriber. Faithful to source — refuses (failed-precondition) when
// the account has no Stripe customer instead of silently creating one, so the
// portal never opens empty. Firebase-free; getStripeClient() 503s when dormant.
export async function POST() {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`billing_portal_${uid}`, 20, 60 * 60 * 1000);

    const profile = await getUserRow(uid);
    if (!profile?.stripe_customer_id) {
      throw new PaymentError(
        "No active subscription found for this account.",
        400,
      );
    }

    const stripe = getStripeClient();
    const appUrl = getAppUrl();
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/account/billing?tab=subscriptions`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

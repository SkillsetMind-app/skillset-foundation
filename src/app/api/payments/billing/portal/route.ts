import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getUserRow, resolvePortalConfigurationId } from "@/lib/payments/server/stripe-helpers";
import { getServerLocale } from "@/lib/i18n/server";

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

    // Our configuration, never the Dashboard default: it switches only between
    // Basic, Starter and Pro, so Enterprise cannot be self-served here.
    const configuration = resolvePortalConfigurationId();
    const stripe = getStripeClient();
    const appUrl = getAppUrl();
    const locale = await getServerLocale();
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      configuration,
      locale,
      return_url: `${appUrl}/account/billing?tab=subscriptions`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

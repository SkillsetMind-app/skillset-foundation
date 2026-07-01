import { NextResponse } from "next/server";

import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Ports createBillingPortalSession: opens the Stripe billing portal for an
// existing subscriber. Faithful to source — refuses (failed-precondition) when
// the account has no Stripe customer instead of silently creating one, so the
// portal never opens empty. Firebase-free; getStripeClient() 503s when dormant.
export async function POST() {
  try {
    const uid = await requireUserId();

    const supabase = await createSupabaseServerClient();
    const { error: rateError } = await supabase.rpc("enforce_rate_limit", {
      p_key: `billing_portal_${uid}`,
      p_limit: 20,
      p_window_ms: 60 * 60 * 1000,
    });
    if (rateError) {
      if (rateError.message?.includes("RATE_LIMIT")) {
        throw new PaymentError(
          "Too many attempts. Please wait before trying again.",
          429,
        );
      }
      throw new Error(rateError.message);
    }

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

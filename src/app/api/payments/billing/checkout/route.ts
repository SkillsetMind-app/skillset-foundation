import { NextResponse } from "next/server";

import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getAppUrl } from "@/lib/payments/server/app-url";
import {
  getOrCreateBillingStripeCustomer,
  getUserRow,
  resolvePriceId,
} from "@/lib/payments/server/stripe-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PlanBillingCycle, PlanId } from "@/data/plans";

// Ports createBillingCheckoutSession: embedded Stripe Checkout for a plan
// subscription. Firebase-free; getStripeClient()/resolvePriceId() surface a
// clean 503 when payments are not configured.
export async function POST(request: Request) {
  try {
    const uid = await requireUserId();

    const supabase = await createSupabaseServerClient();
    const { error: rateError } = await supabase.rpc("enforce_rate_limit", {
      p_key: `billing_checkout_${uid}`,
      p_limit: 10,
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

    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      cycle?: string;
    };
    const rawPlanId = body.planId;
    const rawCycle = body.cycle;

    if (rawPlanId !== "starter" && rawPlanId !== "pro" && rawPlanId !== "plus") {
      throw new PaymentError(
        "planId must be one of: starter, pro, plus.",
        400,
      );
    }
    if (rawCycle !== "monthly" && rawCycle !== "yearly") {
      throw new PaymentError("cycle must be 'monthly' or 'yearly'.", 400);
    }

    const planId = rawPlanId as Exclude<PlanId, "free">;
    const cycle = rawCycle as PlanBillingCycle;
    const priceId = resolvePriceId(planId, cycle);

    const stripe = getStripeClient();
    const profile = await getUserRow(uid);
    const customerId = await getOrCreateBillingStripeCustomer(
      stripe,
      uid,
      profile?.email ?? null,
    );

    const appUrl = getAppUrl();

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        // stripe@22 (apiVersion 2026-04-22.dahlia) renamed the old
        // "embedded" ui_mode to "embedded_page"; client_secret/return_url flow
        // is unchanged. Source used "embedded" against stripe@20.
        ui_mode: "embedded_page",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          metadata: { uid, planId, cycle },
        },
        metadata: {
          uid,
          planId,
          cycle,
          purpose: "skillset_plan_subscription",
        },
        return_url: `${appUrl}/account/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      },
      {
        // Idempotency on (uid, plan, cycle) so a double-click doesn't create two
        // parallel sessions in the same minute.
        idempotencyKey: `billing_checkout_${uid}_${planId}_${cycle}_${Math.floor(
          Date.now() / 60000,
        )}`,
      },
    );

    if (!session.client_secret) {
      throw new Error(
        "Stripe did not return a client_secret for the embedded session.",
      );
    }

    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

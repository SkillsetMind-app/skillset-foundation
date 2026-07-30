import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getAppUrl } from "@/lib/payments/server/app-url";
import {
  getOrCreateBillingStripeCustomer,
  getUserRow,
} from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ACTIVATION_FEE_CHECKOUT_PURPOSE,
  ACTIVATION_FEE_STRIPE_PRICE_ID,
  isActivationFeeConfigured,
} from "@/data/plans";

/**
 * Embedded Stripe Checkout for the one-time storefront activation fee.
 *
 * This is a PLATFORM charge (mode: "payment"), not a direct charge on the
 * creator's connected account: the fee is owed to SkillsetMind, so no
 * `stripeAccount` header and no application fee. The webhook stamps
 * `users.activation_fee_paid_at`; the publish gate reads that column in SQL.
 */
export async function POST() {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`activation_checkout_${uid}`, 10, 60 * 60 * 1000);

    if (!isActivationFeeConfigured()) {
      throw new PaymentError(
        "The activation fee is not configured in Stripe yet.",
        503,
        "payments_not_configured",
      );
    }

    // Charged once, ever. Re-charging a creator who already paid would break the
    // one-time promise outright, so this is a hard 409 rather than a no-op.
    // ponytail: trusts the webhook-maintained column, so a payment completed in
    // the last few seconds can still slip through and create a second session;
    // Stripe refunds that case by hand. Add a sessions.list fallback if it bites.
    const { data: existing, error: existingError } = await getSupabaseAdminClient()
      .from("users")
      .select("activation_fee_paid_at")
      .eq("uid", uid)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.activation_fee_paid_at) {
      throw new PaymentError("Your storefront is already activated.", 409);
    }

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
        mode: "payment",
        ui_mode: "embedded_page",
        customer: customerId,
        line_items: [{ price: ACTIVATION_FEE_STRIPE_PRICE_ID, quantity: 1 }],
        // Mirrored onto the PaymentIntent so a refund/dispute investigation can
        // tell an activation charge from a course sale without the session.
        payment_intent_data: {
          metadata: { uid, purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE },
        },
        metadata: {
          uid,
          purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE,
        },
        return_url: `${appUrl}/teach/activate/return?session_id={CHECKOUT_SESSION_ID}`,
      },
      {
        // Idempotency per uid per minute so a double-click doesn't open two
        // parallel sessions for a fee that must be charged once.
        idempotencyKey: `activation_checkout_${uid}_${Math.floor(
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

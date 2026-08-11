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
import { isPlatformFlagOn } from "@/domain/platform-settings";
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

    const admin = getSupabaseAdminClient();
    const profile = await getUserRow(uid);
    if (!profile) {
      throw new PaymentError("Your profile could not be found.", 404);
    }
    if (!Array.isArray(profile.roles) || !profile.roles.includes("teacher")) {
      throw new PaymentError(
        "A creator account is required to activate a storefront.",
        403,
        "permission_denied",
      );
    }

    const { data: settings, error: settingsError } = await admin
      .from("platform_settings")
      .select("key, value")
      .in("key", ["require_activation_fee", "require_creator_verification"]);
    if (settingsError) throw new Error(settingsError.message);

    const activationRequired = settings?.some(
      (setting) => setting.key === "require_activation_fee"
        && isPlatformFlagOn(setting.value),
    );
    const verificationRequired = settings?.some(
      (setting) => setting.key === "require_creator_verification"
        && isPlatformFlagOn(setting.value),
    );

    if (!activationRequired) {
      throw new PaymentError(
        "Storefront activation is not required right now.",
        409,
        "activation_not_required",
      );
    }
    if (
      verificationRequired
      && profile.creator_verification_status !== "approved"
    ) {
      throw new PaymentError(
        "Professional verification must be approved before activation.",
        403,
        "creator_verification_required",
      );
    }

    if (!isActivationFeeConfigured()) {
      throw new PaymentError(
        "The activation fee is not configured in Stripe yet.",
        503,
        "payments_not_configured",
      );
    }

    if (profile.activation_fee_paid_at) {
      throw new PaymentError("Your storefront is already activated.", 409);
    }

    const stripe = getStripeClient();
    const customerId = await getOrCreateBillingStripeCustomer(
      stripe,
      uid,
      profile.email ?? null,
    );

    // Stripe is the source of truth during the short webhook-lag window. Reuse
    // an open session and repair a paid-but-unstamped profile before considering
    // a new charge.
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    });
    const activationSessions = sessions.data.filter(
      (session) => session.metadata?.uid === uid
        && session.metadata?.purpose === ACTIVATION_FEE_CHECKOUT_PURPOSE,
    );

    // The already-paid check cannot rely on that 100-session page: a creator with
    // 100 newer course-checkout sessions would push their old activation session
    // off it and get charged twice. Search the PaymentIntents instead — the
    // create call below mirrors {uid, purpose} onto every activation intent, so
    // this is authoritative and unpaginated. Search lags ~1min behind writes, so
    // the session scan above still covers a payment made seconds ago.
    const paidIntents = await stripe.paymentIntents.search({
      query: `metadata['uid']:'${uid}' AND metadata['purpose']:'${ACTIVATION_FEE_CHECKOUT_PURPOSE}' AND status:'succeeded'`,
      limit: 1,
    });
    const paidSession = paidIntents.data.length > 0
      || activationSessions.some(
        (session) => session.status === "complete" && session.payment_status === "paid",
      );
    if (paidSession) {
      const timestamp = new Date().toISOString();
      const { error } = await admin
        .from("users")
        .update({ activation_fee_paid_at: timestamp, updated_at: timestamp })
        .eq("uid", uid)
        .is("activation_fee_paid_at", null);
      if (error) throw new Error(error.message);
      throw new PaymentError("Your storefront is already activated.", 409);
    }

    const openSession = activationSessions.find(
      (session) => session.status === "open" && session.client_secret,
    );
    if (openSession?.client_secret) {
      return NextResponse.json({
        clientSecret: openSession.client_secret,
        sessionId: openSession.id,
      });
    }

    const appUrl = getAppUrl();
    const latestActivationSessionId = activationSessions[0]?.id ?? "initial";

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
        idempotencyKey: `activation_checkout_${uid}_${ACTIVATION_FEE_STRIPE_PRICE_ID}_${latestActivationSessionId}`,
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

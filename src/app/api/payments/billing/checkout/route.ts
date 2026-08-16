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
  resolvePriceId,
} from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PlanBillingCycle, PlanId } from "@/data/plans";

// Mirrors COURSE_SUBSCRIPTION_CHECKOUT_BLOCKING_STATUSES minus "incomplete" and
// "paused": an abandoned checkout leaves an `incomplete` row behind, and
// blocking on it would lock the user out of ever subscribing.
const PLAN_CHECKOUT_BLOCKING_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
];

// Written onto every plan session and read back below to tell them apart from
// activation-fee and course sessions on the same customer.
const PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE = "skillset_plan_subscription";

// Ports createBillingCheckoutSession: embedded Stripe Checkout for a plan
// subscription. Firebase-free; getStripeClient()/resolvePriceId() surface a
// clean 503 when payments are not configured.
export async function POST(request: Request) {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`billing_checkout_${uid}`, 10, 60 * 60 * 1000);

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

    // Stripe Checkout never replaces an existing subscription, so a second
    // session bills the user for two plans at once. Plan changes belong in the
    // billing portal (proration + swap); this endpoint is for the first paid
    // plan only. `subscriptions` holds plan subscriptions exclusively — course
    // subscriptions live in `course_subscriptions`.
    // This table is maintained by the webhook, which can lag the actual payment
    // by seconds, so it is the cheap first pass — Stripe itself is asked below
    // before any session is created.
    const { data: existingPlanSubscription, error: existingPlanError } =
      await getSupabaseAdminClient()
        .from("subscriptions")
        .select("id")
        .eq("user_id", uid)
        .in("status", PLAN_CHECKOUT_BLOCKING_STATUSES)
        .limit(1)
        .maybeSingle();
    if (existingPlanError) throw new Error(existingPlanError.message);
    if (existingPlanSubscription) {
      throw new PaymentError(
        "You already have a plan subscription. Change or cancel it from billing instead.",
        409,
      );
    }

    const stripe = getStripeClient();
    const profile = await getUserRow(uid);
    const customerId = await getOrCreateBillingStripeCustomer(
      stripe,
      uid,
      profile?.email ?? null,
    );

    // Second pass, against Stripe rather than our mirror of it. The window the
    // table cannot cover is real money: a creator finishes checkout, the
    // `checkout.session.completed` webhook is still in flight, they open a
    // second tab and subscribe again. Stripe Checkout never replaces an
    // existing subscription, so that leaves two live plans on one card and a
    // refund conversation.
    //
    // This customer only ever exists on the platform account — course
    // subscriptions are direct charges and live on the creator's own connected
    // account — so nothing here can block a legitimate course purchase.
    const stripeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const liveStripeSubscription = stripeSubscriptions.data.find((subscription) =>
      PLAN_CHECKOUT_BLOCKING_STATUSES.includes(subscription.status),
    );
    if (liveStripeSubscription) {
      throw new PaymentError(
        "You already have a plan subscription. Change or cancel it from billing instead.",
        409,
      );
    }

    // Third pass: the sessions themselves. The two checks above only see
    // subscriptions that already exist, and the idempotency bucket below only
    // collapses requests landing inside the same hour — two tabs spanning the
    // boundary still minted two live sessions, and Checkout never replaces a
    // subscription, so paying both opens two plans on one card. Asking Stripe
    // which sessions are open removes the boundary instead of narrowing it.
    // Same shape as the activation checkout, which guards the identical window.
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    });
    const openPlanSessions = sessions.data.filter(
      (candidate) => candidate.status === "open"
        && candidate.client_secret
        && candidate.metadata?.uid === uid
        && candidate.metadata?.purpose === PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE,
    );
    const reusableSession = openPlanSessions.find(
      (candidate) => candidate.metadata?.planId === planId
        && candidate.metadata?.cycle === cycle,
    );

    // Every open session stays payable until it expires, so one left behind for
    // a plan the user has moved on from is the same hazard one step removed.
    for (const staleSession of openPlanSessions) {
      if (staleSession.id !== reusableSession?.id) {
        await stripe.checkout.sessions.expire(staleSession.id);
      }
    }

    const appUrl = getAppUrl();

    // Reuse before create: the response shape below is identical either way, so
    // the returning user gets the session they already have instead of a second.
    const session = reusableSession ?? await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        // stripe@22 (apiVersion 2026-04-22.dahlia) renamed the old
        // "embedded" ui_mode to "embedded_page"; client_secret/return_url flow
        // is unchanged. Source used "embedded" against stripe@20.
        ui_mode: "embedded_page",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // Founding-creator / launch discounts run as Stripe promotion codes on
        // the platform account — no DB, no UI, created in the Dashboard. Safe
        // to combine with nothing else: we never pass `discounts` here.
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { uid, planId, cycle },
        },
        metadata: {
          uid,
          planId,
          cycle,
          purpose: PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE,
        },
        return_url: `${appUrl}/account/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      },
      {
        // Idempotency on (uid, plan, cycle). The bucket is hourly, not
        // per-minute: a minute bucket only collapsed a double-click, so two
        // tabs 2s apart across a minute boundary minted two live sessions and
        // paying both opened two subscriptions. An hour still sits inside the
        // 24h life of both a Checkout Session and a Stripe idempotency record,
        // so a returning user gets the same usable session instead of a second
        // charge.
        idempotencyKey: `billing_checkout_${uid}_${planId}_${cycle}_${Math.floor(
          Date.now() / 3600000,
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

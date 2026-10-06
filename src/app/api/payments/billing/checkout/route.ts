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
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { planDisclosure } from "@/lib/payments/plan-disclosure";
import {
  isPublicPlanId,
  planById,
  PLAN_TRIAL_DAYS,
  type PlanBillingCycle,
} from "@/data/plans";

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
  let releaseClaim: (() => Promise<void>) | null = null;
  let retainClaimOnError = false;
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`billing_checkout_${uid}`, 10, 60 * 60 * 1000);

    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      cycle?: string;
    };
    const rawPlanId = body.planId;
    const rawCycle = body.cycle;

    // Only the plans on offer. The retired Plus keeps working for whoever
    // already has it, but nobody starts a new Plus subscription.
    if (!isPublicPlanId(rawPlanId)) {
      throw new PaymentError(
        "planId must be one of: starter, pro.",
        400,
      );
    }
    if (rawCycle !== "monthly" && rawCycle !== "yearly") {
      throw new PaymentError("cycle must be 'monthly' or 'yearly'.", 400);
    }

    const planId = rawPlanId;
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
    const admin = getSupabaseAdminClient();
    const { data: existingPlanSubscription, error: existingPlanError } =
      await admin
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

    // Serialize every plan/cycle for this user, not just identical creates.
    // The verified service-only RPC uses INSERT ... ON CONFLICT + a row lock.
    // Prefixing the user namespace cannot collide with real Auth UUIDs used
    // by course checkout, even if a course happens to be named "plan".
    const lockUserId = `billing:${uid}`;
    const lockKey = `${lockUserId}__plan`;
    const attemptId = crypto.randomUUID();
    const startedAt = Date.now();
    const lockTtlMs = 35 * 60 * 1000;
    const { data: lockRows, error: lockError } = await admin.rpc("claim_checkout_lock", {
      p_user_id: lockUserId,
      p_course_id: "plan",
      p_order_id: attemptId,
      p_now: new Date(startedAt).toISOString(),
      p_session_ttl_ms: lockTtlMs,
      p_claim_grace_ms: lockTtlMs,
    });
    if (lockError) throw new Error(lockError.message);
    if (["wait", "reuse"].includes(lockRows?.[0]?.action ?? "")) {
      throw new PaymentError("Another plan checkout is in progress. Please wait before trying again.", 409);
    }
    if (lockRows?.[0]?.action !== "claim") throw new Error("Invalid billing checkout claim.");
    releaseClaim = async () => {
      const { error } = await admin.from("checkout_locks").delete()
        .eq("lock_key", lockKey).eq("order_id", attemptId);
      if (error) throw new Error("Could not release the billing checkout claim.");
    };

    const stripe = getStripeClient();
    const profile = await getUserRow(uid);
    const customerId = await getOrCreateBillingStripeCustomer(
      stripe,
      uid,
      profile?.email ?? null,
    );

    // Inspect and replace open sessions while holding the claim.
    // A completed operation releases immediately, so changing plans does not
    // require waiting for an old session or idempotency bucket to expire.
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
    let reusableSession = openPlanSessions.find(
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

    // Read subscriptions after inspecting/expiring earlier sessions: an old
    // tab can complete payment while those requests are in flight. The claim
    // serializes our POSTs, but cannot serialize payment inside Stripe.
    // Delayed payment methods also create active subscriptions, even while
    // the completed Checkout Session still has payment_status "unpaid".
    // Course subscriptions live on connected accounts, not this customer.
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

    // One free trial per creator account, ever. creator_plan_trials is written
    // by the webhook when the first trial starts and outlives the subscription;
    // Stripe's own history covers the seconds before that webhook lands. A
    // second subscription starts paid. Plan changes go through the portal,
    // which keeps the running trial_end, so nothing here can restart a trial.
    const { data: pastTrial, error: pastTrialError } = await admin
      .from("creator_plan_trials")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();
    if (pastTrialError) throw new Error(pastTrialError.message);
    const trialUsed = Boolean(pastTrial)
      || stripeSubscriptions.data.some((subscription) => subscription.trial_start != null);
    const trialDays = trialUsed ? 0 : PLAN_TRIAL_DAYS;

    // An open session promising a trial the account no longer has (or the
    // reverse) must not be handed back.
    if (reusableSession && reusableSession.metadata?.trialDays !== String(trialDays)) {
      await stripe.checkout.sessions.expire(reusableSession.id);
      reusableSession = undefined;
    }

    const appUrl = getAppUrl();
    const locale = await getServerLocale();
    const t = (key: string) => translate(getDictionary(locale), key);
    // The renewal terms on Stripe's own page, above the button that collects
    // the card: same text as the plan card (US ROSCA disclosure).
    const disclosure = planDisclosure({
      t,
      locale,
      plan: planById(planId),
      cycle,
      trial: trialDays > 0,
    });

    // Reuse before create: the response shape below is identical either way, so
    // the returning user gets the session they already have instead of a second.
    // An unknown create outcome keeps the claim until after this session's
    // deadline: a second plan cannot race an object Stripe may still create.
    const sessionExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    if (!reusableSession) {
      // Stripe requires >=30 minutes from creation, not from claim acquisition.
      // Keep the new deadline covered by the claim, with a minute of margin.
      // Slow preparation can retry immediately because create has not run.
      if (sessionExpiresAt * 1000 > startedAt + lockTtlMs - 60_000) {
        throw new PaymentError("Plan checkout preparation timed out. Please try again.", 409);
      }
      retainClaimOnError = true;
    }
    const session = reusableSession ?? await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        // stripe@22 (apiVersion 2026-04-22.dahlia) renamed the old
        // "embedded" ui_mode to "embedded_page"; client_secret/return_url flow
        // is unchanged. Source used "embedded" against stripe@20.
        ui_mode: "embedded_page",
        locale,
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // A card up front, trial or not: the trial converts on its own unless
        // the creator cancels before it ends.
        payment_method_collection: "always",
        custom_text: { submit: { message: disclosure } },
        // Founding-creator / launch discounts run as Stripe promotion codes on
        // the platform account — no DB, no UI, created in the Dashboard. Safe
        // to combine with nothing else: we never pass `discounts` here.
        allow_promotion_codes: true,
        subscription_data: {
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
          // locale: the trial_will_end reminder is sent from the webhook, which
          // never sees this request. The app stores no language for creators.
          metadata: { uid, planId, cycle, locale },
        },
        metadata: {
          uid,
          planId,
          cycle,
          trialDays: String(trialDays),
          purpose: PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE,
        },
        expires_at: sessionExpiresAt,
        return_url: `${appUrl}/account/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      },
      {
        // Per claim, so returning to a previously expired plan creates a fresh
        // session. Stripe's retries inside this attempt still share one key.
        idempotencyKey: `billing_checkout_${attemptId}`,
      },
    );

    if (!session.client_secret) {
      throw new Error(
        "Stripe did not return a client_secret for the embedded session.",
      );
    }

    retainClaimOnError = false;
    await releaseClaim();
    releaseClaim = null;

    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      trialDays,
    });
  } catch (error) {
    if (releaseClaim && !retainClaimOnError) {
      try {
        await releaseClaim();
      } catch {
        return paymentErrorResponse(new Error("Could not release the billing checkout claim."));
      }
    }
    return paymentErrorResponse(error);
  }
}

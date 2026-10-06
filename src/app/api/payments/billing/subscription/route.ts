import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// The creator's plan subscription, for the Billing page: whether a free trial
// is still on offer, the "Free trial — ends {date}" line, and "Cancel plan".
// `subscriptions` and `creator_plan_trials` are service-role only, so the page
// reads them through here. Both tables are kept by the Stripe webhook.

// Everything Stripe may still charge. Mirrors the checkout's blocking list.
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid"];

type SubscriptionRow = {
  id: string;
  plan_id: string | null;
  cycle: string | null;
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

async function findLiveSubscription(uid: string): Promise<SubscriptionRow | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from("subscriptions")
    .select("id,plan_id,cycle,status,trial_end,current_period_end,cancel_at_period_end")
    .eq("user_id", uid)
    .in("status", LIVE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function toView(row: SubscriptionRow | null) {
  if (!row) return null;
  return {
    planId: row.plan_id,
    cycle: row.cycle,
    status: row.status,
    trialEnd: row.status === "trialing" ? row.trial_end : null,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  };
}

export async function GET() {
  try {
    const uid = await requireUserId();
    const [subscription, trial] = await Promise.all([
      findLiveSubscription(uid),
      getSupabaseAdminClient()
        .from("creator_plan_trials")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle(),
    ]);
    if (trial.error) throw new Error(trial.error.message);

    return NextResponse.json({
      trialEligible: !trial.data,
      subscription: toView(subscription),
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

// "Cancel plan": cancel at the end of the current period. During the trial
// that period IS the trial, so the card is never charged. The webhook re-syncs
// the row; it is updated here too so the page reflects the click at once.
export async function POST() {
  try {
    const uid = await requireUserId();
    await enforceRateLimit(`billing_cancel_${uid}`, 10, 60 * 60 * 1000);

    const row = await findLiveSubscription(uid);
    if (!row) {
      throw new PaymentError("No active plan subscription to cancel.", 404);
    }

    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(row.id);
    // Our row was selected by user_id; the Stripe metadata must not disagree.
    if (subscription.metadata?.uid && subscription.metadata.uid !== uid) {
      throw new PaymentError(
        "This subscription is not yours to manage.",
        403,
        "permission_denied",
      );
    }

    const updated = await stripe.subscriptions.update(row.id, {
      cancel_at_period_end: true,
    });

    const { error } = await getSupabaseAdminClient()
      .from("subscriptions")
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    // Stripe already has the cancellation and the webhook re-syncs the row:
    // a failed mirror must not tell the creator the cancel did not happen.
    if (error) console.error("[billing/subscription] mirror cancel failed", error.message);

    return NextResponse.json({
      subscription: toView({ ...row, status: updated.status, cancel_at_period_end: true }),
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

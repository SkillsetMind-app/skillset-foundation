import { NextResponse } from "next/server";

import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Learner-facing course-subscription management. Cancels at period end (the
// learner keeps access through the period they already paid for — the market
// norm) or resumes a pending cancellation. The subscriptionId is read from the
// buyer's own enrollment row (deterministic id, no query/index), then verified
// against the Stripe subscription metadata before any mutation.
// Ported from Firebase cancelCourseSubscription.

// ponytail: inlined secondsToIso (3-line helper, not in foundation).
function secondsToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

export async function POST(request: Request) {
  try {
    const uid = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      courseId?: string;
      resume?: boolean;
    };

    const courseId = String(body?.courseId || "").trim();
    if (!courseId || courseId.length > 160) {
      throw new PaymentError("A valid courseId is required.", 400);
    }
    const resume = body?.resume === true;

    const supabase = await createSupabaseServerClient();
    const { error: rateError } = await supabase.rpc("enforce_rate_limit", {
      p_key: `course_sub_cancel_${uid}`,
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

    const admin = getSupabaseAdminClient();
    const { data: enrollment } = await admin
      .from("enrollments")
      .select("subscription_id")
      .eq("id", `${uid}__${courseId}`)
      .maybeSingle();

    const subscriptionId = enrollment?.subscription_id;
    if (typeof subscriptionId !== "string" || !subscriptionId) {
      throw new PaymentError(
        "No course subscription is attached to your enrollment.",
        400,
      );
    }

    const stripe = getStripeClient();
    // Defensive ownership check: the subscription must be a course subscription
    // owned by this user, regardless of what the enrollment row claims.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (
      subscription.metadata?.purpose !== "course_subscription" ||
      subscription.metadata?.userId !== uid
    ) {
      throw new PaymentError(
        "This subscription is not yours to manage.",
        403,
        "permission_denied",
      );
    }

    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !resume,
    });

    // Reflect immediately; customer.subscription.updated re-syncs the mirror.
    // The mirror row is keyed by id === the Stripe subscription id (Firestore
    // .doc(subscriptionId) convention; matches the reader in
    // @/lib/data/course-subscriptions, which does .eq("id", subscriptionId)).
    await admin
      .from("course_subscriptions")
      .update({
        cancel_at_period_end: !resume,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriptionId);

    const item = updated.items.data[0];
    const currentPeriodEnd = secondsToIso(
      (item as { current_period_end?: number })?.current_period_end ??
        (updated as unknown as { current_period_end?: number })
          .current_period_end,
    );

    return NextResponse.json({
      cancelAtPeriodEnd: !resume,
      currentPeriodEnd,
      status: updated.status,
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

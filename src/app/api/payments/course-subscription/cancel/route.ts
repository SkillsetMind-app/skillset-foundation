import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getCourseSubscriptionCancellationContext } from "@/lib/payments/server/course-subscription-cancellation";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

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

    await enforceRateLimit(`course_sub_cancel_${uid}`, 20, 60 * 60 * 1000);

    const admin = getSupabaseAdminClient();
    const { subscriptionId, stripeAccount } =
      await getCourseSubscriptionCancellationContext(admin, uid, courseId);
    const stripe = getStripeClient();
    // Both calls use the same resolved account. A provider error must not
    // trigger another attempt against the teacher's current account.
    const accountOptions = stripeAccount ? { stripeAccount } : undefined;

    // Defensive ownership check: the subscription must be a course subscription
    // owned by this user, regardless of what the enrollment row claims.
    const subscription = await stripe.subscriptions.retrieve(
      subscriptionId,
      undefined,
      accountOptions,
    );
    if (
      subscription.id !== subscriptionId ||
      subscription.metadata?.purpose !== "course_subscription" ||
      subscription.metadata?.userId !== uid ||
      (subscription.metadata?.courseId !== undefined &&
        subscription.metadata.courseId !== courseId)
    ) {
      throw new PaymentError(
        "This subscription is not yours to manage.",
        403,
        "permission_denied",
      );
    }

    const updated = await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: !resume },
      accountOptions,
    );

    // Best-effort sync; customer.subscription.updated can reconcile the mirror.
    // The mirror row is keyed by id === the Stripe subscription id (matches
    // the reader in @/lib/data/course-subscriptions, which does
    // .eq("id", subscriptionId)).
    try {
      const { error: mirrorError } = await admin
        .from("course_subscriptions")
        .update({
          cancel_at_period_end: updated.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId);
      if (mirrorError) throw mirrorError;
    } catch {
      // Stripe already changed. Report that result, not a misleading failure;
      // its subscription.updated webhook can reconcile the local mirror.
      console.warn("Course subscription updated in Stripe; local mirror sync deferred.");
    }

    const item = updated.items.data[0];
    const currentPeriodEnd = secondsToIso(
      (item as { current_period_end?: number })?.current_period_end ??
        (updated as unknown as { current_period_end?: number })
          .current_period_end,
    );

    return NextResponse.json({
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd,
      status: updated.status,
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";

type CancelCourseSubscriptionResult = {
  /** True after a cancellation is scheduled; false after a resume. */
  cancelAtPeriodEnd: boolean;
  /** ISO end of the paid period the learner keeps access through. */
  currentPeriodEnd: string | null;
  /** Stripe subscription status after the mutation. */
  status: string;
};

/**
 * Schedule (or undo) cancellation of the learner's course subscription. Cancels
 * at period end — the learner keeps access through the period they already paid
 * for (market norm) — or resumes a pending cancellation when `resume` is true.
 * The Route Handler resolves the subscription from the caller's own enrollment
 * and verifies ownership before touching Stripe.
 */
export async function setCourseSubscriptionCancellation(
  courseId: string,
  resume: boolean,
): Promise<CancelCourseSubscriptionResult> {
  return postPaymentRoute<CancelCourseSubscriptionResult>(
    "/api/payments/course-subscription/cancel",
    { courseId, resume },
  );
}

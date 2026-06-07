// Learner-facing mirror of a Stripe course subscription. Written exclusively by
// the Cloud Functions (Stripe webhook + cancelCourseSubscription callable) and
// read by the buyer via firestore.rules (own-read). Mirrors the fields the
// learner's subscription card needs — status, renewal date, cancellation state.

export type CourseSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type CourseSubscription = {
  id: string;
  userId: string;
  courseId: string;
  teacherId?: string;
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  // Stripe status string — typed loosely because Stripe may add states over
  // time; the helpers below classify it.
  status: CourseSubscriptionStatus | string;
  interval?: "month" | "year" | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  pastDue?: boolean;
  latestInvoiceId?: string | null;
};

/** Whether the subscription still entitles the learner to access. */
export function isCourseSubscriptionLive(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

"use client";

import type {
  CourseSubscription,
  CourseSubscriptionStatus,
} from "@/domain/course-subscription";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CourseSubscriptionRow =
  Database["public"]["Tables"]["course_subscriptions"]["Row"];

export function rowToCourseSubscription(row: CourseSubscriptionRow): CourseSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id ?? row.course_slug ?? "",
    teacherId: row.teacher_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? row.id,
    stripeCustomerId: row.stripe_customer_id,
    status: row.status as CourseSubscriptionStatus,
    // These drive the subscription card: renewal date, cancel/resume toggle,
    // past-due banner, interval label. Dropping them left cancelAtPeriodEnd
    // permanently false, so the Resume button never rendered.
    interval: (row.interval as "month" | "year" | null) ?? null,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    pastDue: row.past_due,
    latestInvoiceId: row.latest_invoice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeToTeacherCourseSubscriptions(
  teacherId: string,
  callback: (subscriptions: CourseSubscription[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("course_subscriptions")
      .select("*")
      .eq("teacher_id", teacherId)
      .limit(500);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    callback((data ?? []).map(rowToCourseSubscription));
  };

  void load();

  const channel = supabase
    .channel(`course_subscriptions:teacher:${teacherId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_subscriptions",
        filter: `teacher_id=eq.${teacherId}`,
      },
      () => void load(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Live-subscribe to a single course-subscription mirror row by its Stripe
 * subscription id. The row id is read off the buyer's enrollment, so this is a
 * direct get (no query / composite index) gated by the own-read RLS policy.
 * Reacts in real time as the Stripe webhook updates status.
 */
export function subscribeToCourseSubscription(
  subscriptionId: string,
  callback: (subscription: CourseSubscription | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  void supabase
    .from("course_subscriptions")
    .select("*")
    .eq("id", subscriptionId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToCourseSubscription(data) : null);
    });

  const channel = supabase
    .channel(`course_subscriptions:one:${subscriptionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "course_subscriptions",
        filter: `id=eq.${subscriptionId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(
          rowToCourseSubscription(
            payload.new as unknown as CourseSubscriptionRow,
          ),
        );
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

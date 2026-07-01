"use client";

import type {
  CourseSubscription,
  CourseSubscriptionStatus,
} from "@/domain/course-subscription";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CourseSubscriptionRow =
  Database["public"]["Tables"]["course_subscriptions"]["Row"];

function rowToCourseSubscription(row: CourseSubscriptionRow): CourseSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    // course_subscriptions only mirrors id/user_id/course_slug/status/created_at;
    // Stripe-specific fields (stripeSubscriptionId, interval, etc.) are not stored
    // in this table — leave them absent so callers relying on status still work.
    courseId: row.course_slug,
    stripeSubscriptionId: row.id,
    status: row.status as CourseSubscriptionStatus,
  } as CourseSubscription;
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

"use client";

import type {
  CourseSubscription,
  CourseSubscriptionStatus,
} from "@/domain/course-subscription";
import type { CreatorCourseSubscription } from "@/domain/creator-subscriptions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CourseSubscriptionRow =
  Database["public"]["Tables"]["course_subscriptions"]["Row"];
const TEACHER_PAGE_SIZE = 500;

export function rowToCourseSubscription(
  row: CourseSubscriptionRow,
): CreatorCourseSubscription {
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
    priceAmountMinor: row.price_amount_minor,
    currency: row.currency,
    offerId: row.offer_id,
    priceId: row.price_id,
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
  let loadVersion = 0;
  let stopped = false;

  const load = async () => {
    const version = ++loadVersion;
    const rows: CourseSubscriptionRow[] = [];

    for (let from = 0; ; from += TEACHER_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("course_subscriptions")
        .select("*")
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + TEACHER_PAGE_SIZE - 1);

      if (error) {
        if (!stopped && version === loadVersion) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }

      const page = data ?? [];
      rows.push(...page);
      if (page.length < TEACHER_PAGE_SIZE) break;
    }

    if (!stopped && version === loadVersion) {
      callback(rows.map(rowToCourseSubscription));
    }
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
    stopped = true;
    loadVersion += 1;
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

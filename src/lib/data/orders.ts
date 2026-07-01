"use client";

import type { Order, OrderStatus } from "@/domain/order";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

// The orders table now carries the order-detail columns the Order domain reads
// (course_slug/course_title/platform_fee_bps/provider/checkout_session_id/
// payment_intent_id). Fields still absent from the Postgres schema (teacherId,
// refundedAmountMinor, receiptUrl, paidAt, updatedAt, payoutModel,
// teacherStripeConnectedAccountId) are optional in the domain and stay undefined
// until the Stripe webhook + payout phases add and populate them.
function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id ?? "",
    courseSlug: row.course_slug ?? "",
    courseTitle: row.course_title ?? "",
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status as OrderStatus,
    provider: (row.provider as Order["provider"] | null) ?? "stripe",
    platformFeeBps: row.platform_fee_bps ?? 0,
    checkoutSessionId: row.checkout_session_id,
    paymentIntentId: row.payment_intent_id,
    createdAt: row.created_at,
  };
}

export function subscribeToOrder(
  orderId: string,
  callback: (order: Order | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  void supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToOrder(data) : null);
    });

  const channel = supabase
    .channel(`orders:one:${orderId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `id=eq.${orderId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToOrder(payload.new as unknown as OrderRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToRecentOrders(
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToOrder));
  };

  void load();

  // No single-column eq filter is available for "recent orders" (limit-only
  // query), so subscribe to the whole table and re-run the query on any change.
  // ponytail: table-wide change fan-in; fine for the admin-only recent orders list.
  const channel = supabase
    .channel("orders:recent")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToUserOrders(
  userId: string,
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): () => void {
  // Buyer-scoped history for the Billing -> Purchases / Invoices tabs.
  // Mirrors the original Firestore equality filter on user_id. Callers sort
  // by createdAt client-side. The orders read rule already authorizes
  // `user_id = auth.uid()` via Postgres RLS, so this query is permitted.
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .limit(50);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToOrder));
  };

  void load();

  const channel = supabase
    .channel(`orders:user:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToTeacherOrders(
  teacherId: string,
  callback: (orders: Order[]) => void,
  onError: (error: Error) => void,
): () => void {
  // The Postgres orders table does not have a teacher_id column (the Firestore
  // document did). RLS scopes the result to the caller's own rows. Callers
  // sort client-side; revisit by adding a teacher_id column + index if
  // per-teacher wallet/insights math is needed server-side.
  // ponytail: table-wide change fan-in; no teacher_id column in orders schema.
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .limit(500);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToOrder));
  };

  void load();

  const channel = supabase
    .channel(`orders:teacher:${teacherId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

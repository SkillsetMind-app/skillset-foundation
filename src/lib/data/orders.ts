"use client";

import type { Order, OrderStatus } from "@/domain/order";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
const TEACHER_PAGE_SIZE = 500;

export function mapOrderRow(row: OrderRow): Order {
  const payoutModel =
    row.payout_model === "direct_charge" ||
    row.payout_model === "separate_charges_and_transfers" ||
    row.payout_model === "destination_charge"
      ? row.payout_model
      : undefined;

  return {
    id: row.id,
    userId: row.user_id,
    teacherId: row.teacher_id ?? undefined,
    teacherStripeConnectedAccountId:
      row.teacher_stripe_connected_account_id,
    courseId: row.course_id ?? "",
    courseSlug: row.course_slug ?? "",
    courseTitle: row.course_title ?? "",
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status as OrderStatus,
    provider: (row.provider as Order["provider"] | null) ?? "stripe",
    platformFeeBps: row.platform_fee_bps ?? 0,
    payoutModel,
    checkoutSessionId: row.checkout_session_id,
    paymentIntentId: row.payment_intent_id,
    refundedAmountMinor: row.refunded_amount_minor,
    receiptUrl: row.receipt_url,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
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
      callback(data ? mapOrderRow(data) : null);
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
        callback(mapOrderRow(payload.new as unknown as OrderRow));
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

    callback((data ?? []).map(mapOrderRow));
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

    callback((data ?? []).map(mapOrderRow));
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
  // Scope both the initial query and realtime fan-in to this teacher. The
  // canonical order row now carries teacher_id for one-time and recurring sales.
  const supabase = getSupabaseBrowserClient();
  let loadVersion = 0;
  let stopped = false;

  const load = async () => {
    const version = ++loadVersion;
    const rows: OrderRow[] = [];

    for (let from = 0; ; from += TEACHER_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("orders")
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
      callback(rows.map(mapOrderRow));
    }
  };

  void load();

  const channel = supabase
    .channel(`orders:teacher:${teacherId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `teacher_id=eq.${teacherId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    stopped = true;
    loadVersion += 1;
    void supabase.removeChannel(channel);
  };
}

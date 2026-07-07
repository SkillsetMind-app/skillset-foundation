"use client";

import type { PayoutLedgerEntry, PayoutLedgerStatus } from "@/domain/payout-ledger";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type PayoutLedgerRow = Database["public"]["Tables"]["payout_ledger"]["Row"];

function rowToPayoutLedgerEntry(row: PayoutLedgerRow): PayoutLedgerEntry {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherStripeConnectedAccountId: row.teacher_stripe_connected_account_id,
    courseId: row.course_id ?? "",
    orderId: row.order_id ?? "",
    paymentId: row.payment_id ?? "",
    grossAmountMinor: row.gross_amount_minor,
    skillsetFeeMinor: row.skillset_fee_minor,
    stripeFeeMinor: row.stripe_fee_minor,
    // Authoritative net the webhook computed and stored (gross - skillset fee -
    // stripe fee). Never recompute from amount_minor - platform_fee_minor: that
    // omits the Stripe processing fee and overstates the teacher's balance.
    netAmountMinor: row.net_amount_minor,
    currency: row.currency,
    platformFeeBps: row.platform_fee_bps ?? undefined,
    status: row.status as PayoutLedgerStatus,
    releaseAt: row.release_at ?? undefined,
    // No released_at column — the actual-release timestamp isn't tracked yet.
    releasedAt: undefined,
    transferId: row.transfer_id,
    refundedAmountMinor: row.refunded_amount_minor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeToTeacherPayoutLedger(
  teacherId: string,
  callback: (entries: PayoutLedgerEntry[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    // Equality filter + bounded fetch with no server-side order (single-field
    // index only). Callers sort client-side; we fetch up to 500 rows to avoid
    // silently summing an arbitrary subset past any hard limit.
    const { data, error } = await supabase
      .from("payout_ledger")
      .select("*")
      .eq("teacher_id", teacherId)
      .limit(500);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToPayoutLedgerEntry));
  };

  void load();

  const channel = supabase
    .channel(`payout_ledger:teacher:${teacherId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "payout_ledger",
        filter: `teacher_id=eq.${teacherId}`,
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

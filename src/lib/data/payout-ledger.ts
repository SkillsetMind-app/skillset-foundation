"use client";

import type { PayoutLedgerEntry, PayoutLedgerStatus } from "@/domain/payout-ledger";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type PayoutLedgerRow = Database["public"]["Tables"]["payout_ledger"]["Row"];

function rowToPayoutLedgerEntry(row: PayoutLedgerRow): PayoutLedgerEntry {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    paymentId: row.payment_id ?? "",
    // The current Postgres schema captures the core money columns; richer fields
    // (grossAmountMinor, skillsetFeeMinor, netAmountMinor, etc.) live in the
    // domain type but are not yet in the payout_ledger table — they will be
    // undefined until a future migration adds them.
    grossAmountMinor: row.amount_minor,
    skillsetFeeMinor: row.platform_fee_minor,
    netAmountMinor: row.amount_minor - row.platform_fee_minor,
    currency: row.currency,
    status: row.status as PayoutLedgerStatus,
    createdAt: row.created_at,
    // Fields not yet in the DB schema — domain type marks them optional.
    teacherStripeConnectedAccountId: undefined,
    courseId: "",
    orderId: "",
    stripeFeeMinor: undefined,
    platformFeeBps: undefined,
    releaseAt: undefined,
    releasedAt: undefined,
    transferId: undefined,
    refundedAmountMinor: undefined,
    updatedAt: undefined,
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

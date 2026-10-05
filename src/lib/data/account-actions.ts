"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type AccountActionRequestType = "account_deletion" | "data_export";
export type AccountActionStatus = "pending" | "processing" | "completed" | "rejected";

export type AccountActionResolution = Exclude<AccountActionStatus, "pending">;

const openStatuses: AccountActionStatus[] = ["pending", "processing"];
const closedStatuses: AccountActionStatus[] = ["completed", "rejected"];

// Postgres timestamptz comes back as an ISO string, not a Firestore Timestamp.
export type AccountActionRequest = {
  id: string;
  type: AccountActionRequestType;
  requestedBy: string;
  email: string | null;
  status: AccountActionStatus;
  requestedAt: string | null;
  updatedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

const accountActionRequestsTable = "account_action_requests";
// realtime-js returns the SAME channel for a repeated topic and drops a second
// identical postgres_changes binding, so the Ops badge and the panel would
// silently share one listener (and one teardown). One topic per subscription.
let subscriptionSeq = 0;

type AccountActionRequestRow =
  Database["public"]["Tables"]["account_action_requests"]["Row"];

function rowToRequest(row: AccountActionRequestRow): AccountActionRequest {
  return {
    id: row.id,
    type: row.type as AccountActionRequestType,
    requestedBy: row.requested_by,
    email: row.email,
    status: row.status as AccountActionStatus,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
  };
}

// requestDataExport / requestAccountDeletion callables → request_account_action
// RPC (SECURITY DEFINER): rate-limited, writes the pending request + an audit
// entry atomically, and authorizes the caller server-side via auth.uid().
export async function requestDataExportAction(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("request_account_action", {
    p_type: "data_export",
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export async function requestAccountDeletionAction(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("request_account_action", {
    p_type: "account_deletion",
  });

  if (error) {
    throw error;
  }

  return data as string;
}

export function subscribeToAccountActionRequests(
  callback: (requests: AccountActionRequest[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    // Every open request (the ones on the 30-day clock), oldest first, then
    // the 50 most recently closed as history. A single "50 newest of any
    // status" read let newer closed requests push the oldest open one — the
    // one closest to day 30 — out of the list and the Ops badge.
    const [open, closed] = await Promise.all([
      supabase
        .from(accountActionRequestsTable)
        .select("*")
        .in("status", openStatuses)
        .order("requested_at", { ascending: true }),
      supabase
        .from(accountActionRequestsTable)
        .select("*")
        .in("status", closedStatuses)
        .order("requested_at", { ascending: false })
        .limit(50),
    ]);

    const error = open.error ?? closed.error;
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback([...(open.data ?? []), ...(closed.data ?? [])].map(rowToRequest));
  };

  void load();

  // No single-column eq filter for "the whole admin queue" — subscribe to the
  // table and re-run the query on any change.
  // ponytail: table-wide change fan-in; fine for the admin-only account queue.
  const channel = supabase
    .channel(`account_action_requests:queue:${++subscriptionSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: accountActionRequestsTable },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Action a GDPR export/deletion request from the admin queue so it never sits
 * unworked. Records who actioned it and when. Admin only — enforced by the
 * account_action_requests RLS update policy (is_admin()).
 */
export async function resolveAccountActionRequest(
  requestId: string,
  status: AccountActionResolution,
  adminId: string,
) {
  const supabase = getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from(accountActionRequestsTable)
    .update({
      status,
      resolved_by: adminId,
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", requestId);

  if (error) {
    throw error;
  }
}

"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  actorEmail: string | null;
  targetType: string;
  targetId: string;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string | null;
}

function rowToAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    targetType: row.target_type,
    targetId: row.target_id,
    summary: row.summary,
    metadata: (row.metadata as unknown as Record<string, string | number | boolean | null>) ?? {},
    createdAt: row.created_at,
  };
}

/**
 * Streams the most recent audit entries (newest first) for the admin ops
 * dashboard. Read access is enforced by Postgres RLS (admins only); this
 * table is never written from the client.
 */
export function subscribeToAuditLog(
  callback: (entries: AuditLogEntry[]) => void,
  onError: (error: Error) => void,
  max = 100,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(max);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToAuditLogEntry));
  };

  void load();

  // ponytail: table-wide change fan-in; audit_log has no single-column eq
  // filter to use for Realtime — re-run the sorted+limited query on any change.
  const channel = supabase
    .channel("audit_log:all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "audit_log" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

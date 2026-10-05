"use client";

import type {
  CreateSupportTicketInput,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketStatus,
} from "@/domain/support-ticket";
import { toDate } from "@/lib/format-date";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type SupportTicketRow = Database["public"]["Tables"]["support_tickets"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToSupportTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    category: row.category as SupportTicketCategory,
    subject: row.subject,
    message: row.message,
    status: row.status as SupportTicketStatus,
    adminResponse: row.admin_response,
    respondedBy: row.responded_by,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSupportTicket(input: CreateSupportTicketInput) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: input.userId,
      user_email: input.userEmail,
      user_name: input.userName,
      category: input.category,
      subject: input.subject.trim(),
      message: input.message.trim(),
      status: "open",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

export function subscribeToUserSupportTickets(
  userId: string,
  callback: (tickets: SupportTicket[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    // Latest activity first: a fresh reply or status change rises to the top.
    const activity = (ticket: SupportTicket) =>
      (toDate(ticket.updatedAt) ?? toDate(ticket.createdAt))?.getTime() ?? 0;
    callback((data ?? []).map(rowToSupportTicket).sort((left, right) => activity(right) - activity(left)));
  };

  void load();

  const channel = supabase
    .channel(`support_tickets:user:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_tickets",
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

// Whoever has waited longest is answered first; resolved tickets sink to the
// bottom, most recently closed first.
// ponytail: every ticket is still read, resolved included; cap the resolved
// tail in the query (second read or RPC) once it gets long enough to matter.
function adminQueueOrder(left: SupportTicket, right: SupportTicket): number {
  const leftDone = left.status === "resolved";
  if (leftDone !== (right.status === "resolved")) return leftDone ? 1 : -1;
  const time = (ticket: SupportTicket) => toDate(leftDone ? ticket.updatedAt : ticket.createdAt)?.getTime() ?? 0;
  return leftDone ? time(right) - time(left) : time(left) - time(right);
}

export function subscribeToAdminSupportTickets(
  callback: (tickets: SupportTicket[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let generation = 0;

  const load = async () => {
    if (!active) return;
    const currentGeneration = ++generation;
    const { data, error } = await supabase.from("support_tickets").select("*");

    // An older refresh must not revive resolved tickets or replace a newer error.
    if (!active || currentGeneration !== generation) return;
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToSupportTicket).sort(adminQueueOrder));
  };

  void load();

  // ponytail: table-wide change fan-in; admin view has no single-column filter.
  const channel = supabase
    .channel("support_tickets:admin")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_tickets" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

export async function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("support_tickets")
    .update({ status, updated_at: nowIso() })
    .eq("id", ticketId);

  if (error) throw error;
}

/**
 * Post a support reply the ticket owner can read back, and resolve the ticket.
 * Admin/support only (enforced by RLS supportCanUpdateTicketStatus).
 */
export async function respondToSupportTicket(
  ticketId: string,
  response: string,
  responderId: string,
) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { error } = await supabase
    .from("support_tickets")
    .update({
      admin_response: response.trim(),
      responded_by: responderId,
      responded_at: timestamp,
      status: "resolved",
      updated_at: timestamp,
    })
    .eq("id", ticketId);

  if (error) throw error;
}

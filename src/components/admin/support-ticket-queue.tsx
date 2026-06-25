"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import {
  supportTicketCategoryLabels,
  supportTicketStatusLabels,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/domain/support-ticket";
import {
  respondToSupportTicket,
  subscribeToAdminSupportTickets,
  updateSupportTicketStatus,
} from "@/lib/data/support-tickets";

const nextStatuses: SupportTicketStatus[] = ["open", "in_review", "resolved"];

export function SupportTicketQueue() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToAdminSupportTickets(
      (nextTickets) => {
        setTickets(nextTickets);
        setIsLoading(false);
      },
      () => {
        setError("We could not load support tickets.");
        setIsLoading(false);
      },
    );
  }, []);
  const exportRows = useMemo(
    () =>
      tickets.map((ticket) => ({
        id: ticket.id,
        category: supportTicketCategoryLabels[ticket.category],
        status: supportTicketStatusLabels[ticket.status],
        subject: ticket.subject,
        user: ticket.userName || ticket.userEmail || ticket.userId,
        message: ticket.message,
      })),
    [tickets],
  );

  async function handleStatusUpdate(ticketId: string, status: SupportTicketStatus) {
    setError("");
    setActiveTicketId(ticketId);

    try {
      await updateSupportTicketStatus(ticketId, status);
    } catch {
      setError("We could not update this support ticket.");
    } finally {
      setActiveTicketId(null);
    }
  }

  async function handleReply(ticketId: string) {
    const draft = (replyDrafts[ticketId] ?? "").trim();

    if (!user || draft.length < 2) {
      return;
    }

    setError("");
    setReplyingTicketId(ticketId);

    try {
      await respondToSupportTicket(ticketId, draft, user.uid);
      setReplyDrafts((drafts) => ({ ...drafts, [ticketId]: "" }));
    } catch {
      setError("We could not send this reply.");
    } finally {
      setReplyingTicketId(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Support queue
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            User support tickets
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Read user issues, identify support needs, and move tickets through
            a simple status workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportTableButton filename="skillset-support-tickets" rows={exportRows} />
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {tickets.length} tickets
          </span>
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">Loading support tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No support tickets are open right now.
          </p>
        ) : (
          tickets.map((ticket) => (
            <article
              key={ticket.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {supportTicketCategoryLabels[ticket.category]}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {ticket.subject}
                  </h4>
                </div>
                <StatusChip
                  status={ticket.status}
                  label={supportTicketStatusLabels[ticket.status]}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                {ticket.userName || "Unnamed user"} - {ticket.userEmail || ticket.userId}
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                {ticket.message}
              </p>
              {ticket.adminResponse ? (
                <div className="mt-3 rounded-[10px] border fine-rule bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                    Reply sent to user
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                    {ticket.adminResponse}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 grid gap-2">
                <textarea
                  value={replyDrafts[ticket.id] ?? ""}
                  onChange={(event) =>
                    setReplyDrafts((drafts) => ({
                      ...drafts,
                      [ticket.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Write a reply the user will read, then resolve the ticket."
                  className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
                />
                <button
                  type="button"
                  onClick={() => handleReply(ticket.id)}
                  disabled={
                    replyingTicketId === ticket.id
                    || (replyDrafts[ticket.id] ?? "").trim().length < 2
                  }
                  className="button-solid w-fit px-4 py-2 text-xs disabled:opacity-60"
                >
                  {replyingTicketId === ticket.id
                    ? "Sending..."
                    : ticket.adminResponse
                      ? "Update reply"
                      : "Send reply and resolve"}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {nextStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleStatusUpdate(ticket.id, status)}
                    disabled={activeTicketId === ticket.id || ticket.status === status}
                    className="button-outline px-4 py-2 text-xs disabled:opacity-60"
                  >
                    {supportTicketStatusLabels[status]}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

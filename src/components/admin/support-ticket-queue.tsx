"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { Field, InlineAlert } from "@/components/ui";
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
const copy = "platform.ops.supportQueue";

export function SupportTicketQueue({ query = "" }: { query?: string }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<"statusError" | "replyError" | null>(null);
  const [success, setSuccess] = useState<"statusSuccess" | "replySuccess" | null>(null);
  const normalizedQuery = query.toLowerCase().trim();
  const visibleTickets = useMemo(
    () => tickets.filter((ticket) => [
      ticket.id, ticket.userId, ticket.userName, ticket.userEmail, ticket.subject,
      ticket.message, ticket.adminResponse, ticket.category, ticket.status,
      t(`${copy}.categories.${ticket.category}`), t(`statusChip.${ticket.status}`),
    ].join(" ").toLowerCase().includes(normalizedQuery)),
    [tickets, normalizedQuery, t],
  );

  useEffect(() => {
    return subscribeToAdminSupportTickets(
      (nextTickets) => {
        setTickets(nextTickets);
        setLoadError(false);
        setIsLoading(false);
      },
      () => {
        setLoadError(true);
        setIsLoading(false);
      },
    );
  }, []);
  const exportRows = useMemo(
    () =>
      visibleTickets.map((ticket) => ({
        id: ticket.id,
        category: supportTicketCategoryLabels[ticket.category],
        status: supportTicketStatusLabels[ticket.status],
        subject: ticket.subject,
        user: ticket.userName || ticket.userEmail || ticket.userId,
        message: ticket.message,
      })),
    [visibleTickets],
  );

  async function handleStatusUpdate(ticketId: string, status: SupportTicketStatus) {
    setError(null);
    setSuccess(null);
    setActiveTicketId(ticketId);

    try {
      await updateSupportTicketStatus(ticketId, status);
      setSuccess("statusSuccess");
    } catch {
      setError("statusError");
    } finally {
      setActiveTicketId(null);
    }
  }

  async function handleReply(ticketId: string) {
    const draft = (replyDrafts[ticketId] ?? "").trim();

    if (!user || draft.length < 2) {
      return;
    }

    setError(null);
    setSuccess(null);
    setReplyingTicketId(ticketId);

    try {
      await respondToSupportTicket(ticketId, draft, user.uid);
      setReplyDrafts((drafts) => ({ ...drafts, [ticketId]: "" }));
      setSuccess("replySuccess");
    } catch {
      setError("replyError");
    } finally {
      setReplyingTicketId(null);
    }
  }

  return (
    <section className="min-w-0 break-words rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("platform.ops.support")}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <ExportTableButton filename="skillset-support-tickets" rows={exportRows} />
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {isLoading ? t("platform.queueCount.loading") : loadError ? t("platform.queueCount.unavailable")
              : t(`${copy}.${tickets.length === 1 ? "countOne" : "count"}`).replace("{count}", String(tickets.length))}
          </span>
        </div>
      </div>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.${error}`)}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" className="mt-5">{t(`${copy}.${success}`)}</InlineAlert> : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p>
        ) : loadError ? null : visibleTickets.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.${tickets.length === 0 ? "empty" : "noResults"}`)}
          </p>
        ) : (
          visibleTickets.map((ticket) => (
            <article
              key={ticket.id}
              className="min-w-0 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {t(`${copy}.categories.${ticket.category}`)}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {ticket.subject}
                  </h4>
                </div>
                <StatusChip status={ticket.status} />
              </div>
              <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                {ticket.userName || t(`${copy}.unnamedUser`)} - {ticket.userEmail || ticket.userId}
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                {ticket.message}
              </p>
              {ticket.adminResponse ? (
                <div className="mt-3 rounded-[10px] border fine-rule bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                    {t(`${copy}.replySentLabel`)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                    {ticket.adminResponse}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 grid gap-2">
                <Field
                  id={`support-reply-${ticket.id}`}
                  label={t(`${copy}.replyLabel`)}
                  hint={t(`${copy}.replyHint`)}
                  className="min-w-0"
                >
                  {(a11y) => (
                    <textarea
                      {...a11y}
                      value={replyDrafts[ticket.id] ?? ""}
                      onChange={(event) =>
                        setReplyDrafts((drafts) => ({
                          ...drafts,
                          [ticket.id]: event.target.value,
                        }))
                      }
                      rows={3}
                      placeholder={t(`${copy}.replyPlaceholder`)}
                      className="min-w-0 resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
                    />
                  )}
                </Field>
                <button
                  type="button"
                  onClick={() => handleReply(ticket.id)}
                  disabled={
                    replyingTicketId === ticket.id
                    || (replyDrafts[ticket.id] ?? "").trim().length < 2
                  }
                  className="button-solid max-w-full w-fit whitespace-normal px-4 py-2 text-xs disabled:opacity-60"
                >
                  {replyingTicketId === ticket.id
                    ? t(`${copy}.sending`)
                    : ticket.adminResponse
                      ? t(`${copy}.updateReply`)
                      : t(`${copy}.sendReply`)}
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
                    {activeTicketId === ticket.id ? t(`${copy}.updating`) : t(`statusChip.${status}`)}
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

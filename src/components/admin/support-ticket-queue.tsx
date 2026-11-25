"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { BusyLabel, Button, Field, InlineAlert } from "@/components/ui";
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
  // Which status was pressed: only it spins; the others just lock (I-08).
  const [activeStatus, setActiveStatus] = useState<SupportTicketStatus | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);
  // The reply box opens through "Reply", only on the requested ticket: ten tickets
  // were ten open boxes and ten primary buttons (I-09). The draft stays
  // saved if the box closes without sending.
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
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
    setActiveStatus(status);

    try {
      await updateSupportTicketStatus(ticketId, status);
      setSuccess("statusSuccess");
    } catch {
      setError("statusError");
    } finally {
      setActiveTicketId(null);
      setActiveStatus(null);
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
      closeReply(ticketId);
    } catch {
      setError("replyError");
    } finally {
      setReplyingTicketId(null);
    }
  }

  // Closes the box and returns focus to the "Reply" that opened it: the button that had
  // focus disappears with the box, and focus would fall to the top of the page.
  function closeReply(ticketId: string) {
    flushSync(() => setOpenReplies((open) => ({ ...open, [ticketId]: false })));
    document.getElementById(`support-reply-open-${ticketId}`)?.focus();
  }

  return (
    <section className="min-w-0 break-words rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <ExportTableButton filename="skillset-support-tickets" rows={exportRows} />
          <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
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
          <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.${tickets.length === 0 ? "empty" : "noResults"}`)}
          </p>
        ) : (
          visibleTickets.map((ticket) => (
            <article
              key={ticket.id}
              className="min-w-0 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
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
                <div className="mt-3 rounded-md border fine-rule bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                    {t(`${copy}.replySentLabel`)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                    {ticket.adminResponse}
                  </p>
                </div>
              ) : null}
              {openReplies[ticket.id] ? (
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
                        autoFocus
                        value={replyDrafts[ticket.id] ?? ""}
                        onChange={(event) =>
                          setReplyDrafts((drafts) => ({
                            ...drafts,
                            [ticket.id]: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder={t(`${copy}.replyPlaceholder`)}
                        className="field-input min-w-0 resize-none"
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleReply(ticket.id)}
                      disabled={
                        replyingTicketId === ticket.id
                        || (replyDrafts[ticket.id] ?? "").trim().length < 2
                      }
                      className="button-solid max-w-full w-fit whitespace-normal px-4 py-2 text-xs"
                    >
                      <BusyLabel
                        busy={replyingTicketId === ticket.id}
                        idle={ticket.adminResponse ? t(`${copy}.updateReply`) : t(`${copy}.sendReply`)}
                        busyText={t(`${copy}.sending`)}
                      />
                    </button>
                    <Button variant="outline" size="sm" className="min-h-11 px-4 py-2" disabled={replyingTicketId === ticket.id}
                      onClick={() => closeReply(ticket.id)}>
                      {t("platform.ops.confirmDialog.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {/* Each status always in the same place, the current one locked: taking the current one
                  out of the queue made the button under the click become another status, and
                  a 2nd click reopened the ticket (I-09). */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {openReplies[ticket.id] ? null : (
                  <Button id={`support-reply-open-${ticket.id}`} variant="outline" size="sm" className="min-h-11 px-4 py-2"
                    onClick={() => setOpenReplies((open) => ({ ...open, [ticket.id]: true }))}>
                    {t(`${copy}.reply`)}
                  </Button>
                )}
                <div role="group" aria-labelledby={`support-move-${ticket.id}`} className="flex flex-wrap items-center gap-2">
                  <span id={`support-move-${ticket.id}`} className="text-xs font-semibold text-[var(--color-ink-soft)]">
                    {t(`${copy}.moveTo`)}
                  </span>
                  {nextStatuses.map((status) => (
                    <Button
                      key={status}
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusUpdate(ticket.id, status)}
                      disabled={activeTicketId === ticket.id || ticket.status === status}
                      loading={activeTicketId === ticket.id && activeStatus === status}
                      busyLabel={t(`statusChip.${status}`)}
                      className="min-h-11 px-4 py-2"
                    >
                      {t(`statusChip.${status}`)}
                    </Button>
                  ))}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

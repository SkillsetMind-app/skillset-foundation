"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  supportTicketCategoryLabels,
  type SupportTicket,
  type SupportTicketCategory,
} from "@/domain/support-ticket";
import { isRateLimitError } from "@/lib/data/rate-limit-error";
import {
  createSupportTicket,
  subscribeToUserSupportTickets,
} from "@/lib/data/support-tickets";

const categories = Object.keys(supportTicketCategoryLabels) as SupportTicketCategory[];
const copy = "supportCenter";

export function SupportTicketCenter() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState<SupportTicketCategory>("course");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<"" | "loadError" | "validationError" | "createError" | "rateLimit">("");
  const [success, setSuccess] = useState<"" | "created">("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserSupportTickets(
      user.uid,
      (nextTickets) => {
        setTickets(nextTickets);
        setIsLoading(false);
      },
      () => {
        setError("loadError");
        setIsLoading(false);
      },
    );
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    if (subject.trim().length < 4 || message.trim().length < 12) {
      setError("validationError");
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      await createSupportTicket({
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName,
        category,
        subject,
        message,
      });
      setSubject("");
      setMessage("");
      setCategory("course");
      setSuccess("created");
    } catch (failure) {
      setError(isRateLimitError(failure) ? "rateLimit" : "createError");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t(`${copy}.eyebrow`)}
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          {t(`${copy}.title`)}
        </h3>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t(`${copy}.description`)}
        </p>
        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t(`${copy}.category`)}
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {t(`platform.ops.supportQueue.categories.${item}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t(`${copy}.subject`)}
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t(`${copy}.subjectPlaceholder`)}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t(`${copy}.details`)}
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={6}
              placeholder={t(`${copy}.detailsPlaceholder`)}
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
              {t(`${copy}.${error}`)}
            </p>
          ) : null}
          {success ? (
            <p role="status" className="info-notice">
              {t(`${copy}.${success}`)}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t(`${copy}.${isSubmitting ? "creating" : "create"}`)}
          </button>
        </form>
      </section>

      <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t(`${copy}.yourTickets`)}
        </p>
        <div className="mt-6 grid gap-3">
          {isLoading ? (
            <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p>
          ) : tickets.length === 0 ? (
            <p className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t(`${copy}.empty`)}
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
                      {t(`platform.ops.supportQueue.categories.${ticket.category}`)}
                    </p>
                    <h4 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                      {ticket.subject}
                    </h4>
                  </div>
                  <StatusChip
                    status={ticket.status}
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {ticket.message}
                </p>
                {ticket.adminResponse ? (
                  <div className="mt-3 rounded-[10px] border border-[rgba(26,54,93,0.14)] bg-white p-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                      {t(`${copy}.replied`)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                      {ticket.adminResponse}
                    </p>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { InlineAlert } from "@/components/ui";
import {
  resolveAccountActionRequest,
  subscribeToAccountActionRequests,
  type AccountActionRequest,
  type AccountActionResolution,
} from "@/lib/data/account-actions";
import { toDate } from "@/lib/format-date";

const resolutionActions: AccountActionResolution[] = ["processing", "completed", "rejected"];
const DAY_MS = 24 * 60 * 60 * 1000;

function formatTimestamp(value: AccountActionRequest["requestedAt"], locale: string, pending: string) {
  const date = toDate(value);

  if (!date) {
    return pending;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AccountActionRequestsPanel() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const copy = "platform.ops.accountRequestsPanel";
  const [requests, setRequests] = useState<AccountActionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // ponytail: read once per mount; a day counter does not need to tick live.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    return subscribeToAccountActionRequests(
      (nextRequests) => {
        setRequests(nextRequests);
        setLoadError(false);
        setIsLoading(false);
      },
      () => {
        setLoadError(true);
        setIsLoading(false);
      },
    );
  }, []);

  async function handleResolve(requestId: string, status: AccountActionResolution) {
    if (!user) {
      return;
    }

    setError(false);
    setActiveRequestId(requestId);

    try {
      await resolveAccountActionRequest(requestId, status, user.uid);
    } catch {
      setError(true);
    } finally {
      setActiveRequestId(null);
    }
  }

  return (
    <section className="rounded-none border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t(`${copy}.eyebrow`)}
      </p>
      <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
        {t(`${copy}.title`)}
      </h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t(`${copy}.description`)}
      </p>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.updateError`)}</InlineAlert> : null}

      <div className="mt-5 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        ) : requests.length === 0 ? (
          loadError ? null : <div className="rounded-none border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5 text-sm leading-7 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</div>
        ) : (
          requests.map((request) => {
            const requested = toDate(request.requestedAt);
            // Day 1 is the day it arrived. Deletion/export answers are owed within 30 days.
            const day = requested && (request.status === "pending" || request.status === "processing")
              ? Math.max(1, Math.floor((now - requested.getTime()) / DAY_MS) + 1)
              : null;
            return (
            <article
              key={request.id}
              className="rounded-none border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--color-ink)]">
                    {t(`${copy}.types.${request.type === "data_export" ? "data_export" : "account_deletion"}`)}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                    {t(`${copy}.user`)} {request.requestedBy}
                    {request.email ? ` - ${request.email}` : ""}
                  </p>
                </div>
                <StatusChip status={request.status} />
              </div>
              <p className="mt-3 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                {t(`${copy}.requested`)} {formatTimestamp(request.requestedAt, locale, t(`${copy}.pendingTimestamp`))} - {t(`${copy}.requestId`)} {request.id}
              </p>
              {day ? (
                <p className={`mt-1 text-xs font-semibold ${day > 30 ? "text-[var(--color-danger-fg)]" : "text-[var(--color-ink)]"}`}>
                  {t(`${copy}.deadline`).replace("{day}", String(day))}
                </p>
              ) : null}
              {request.resolvedAt ? (
                <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t(`${copy}.actioned`)} {formatTimestamp(request.resolvedAt, locale, t(`${copy}.pendingTimestamp`))}
                  {request.resolvedBy ? <> {t(`${copy}.by`)} {request.resolvedBy}</> : null}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {resolutionActions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleResolve(request.id, status)}
                    disabled={
                      activeRequestId === request.id || request.status === status
                    }
                    className="button-outline min-h-11 px-4 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.actions.${status}`)}
                  </button>
                ))}
              </div>
            </article>
            );
          })
        )}
      </div>
    </section>
  );
}

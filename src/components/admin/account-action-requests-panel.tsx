"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  resolveAccountActionRequest,
  subscribeToAccountActionRequests,
  type AccountActionRequest,
  type AccountActionResolution,
} from "@/lib/data/account-actions";

const resolutionActions: Array<{ status: AccountActionResolution; label: string }> = [
  { status: "processing", label: "Mark processing" },
  { status: "completed", label: "Mark completed" },
  { status: "rejected", label: "Reject" },
];

function formatType(type: AccountActionRequest["type"]) {
  return type === "data_export" ? "Data export" : "Account deletion";
}

function formatTimestamp(value: AccountActionRequest["requestedAt"]) {
  const date = value?.toDate?.();

  if (!date) {
    return "Pending timestamp";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AccountActionRequestsPanel() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<AccountActionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToAccountActionRequests(
      (nextRequests) => {
        setRequests(nextRequests);
        setIsLoading(false);
      },
      () => {
        setError("We could not load account action requests.");
        setIsLoading(false);
      },
    );
  }, []);

  async function handleResolve(requestId: string, status: AccountActionResolution) {
    if (!user) {
      return;
    }

    setError("");
    setActiveRequestId(requestId);

    try {
      await resolveAccountActionRequest(requestId, status, user.uid);
    } catch {
      setError("We could not update this account action request.");
    } finally {
      setActiveRequestId(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Account actions
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        Export and deletion requests.
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Promise Section 03 and Section 04 requests land here. Work each request,
        then mark it processing, completed, or rejected so the queue stays clean.
      </p>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading account action requests...
          </p>
        ) : requests.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5 text-sm leading-7 text-[var(--color-ink-soft)]">
            No account action requests yet.
          </div>
        ) : (
          requests.map((request) => (
            <article
              key={request.id}
              className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[var(--color-ink)]">
                    {formatType(request.type)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    User {request.requestedBy}
                    {request.email ? ` - ${request.email}` : ""}
                  </p>
                </div>
                <StatusChip status={request.status} />
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
                Requested {formatTimestamp(request.requestedAt)} - Request ID {request.id}
              </p>
              {request.resolvedAt ? (
                <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                  Actioned {formatTimestamp(request.resolvedAt)}
                  {request.resolvedBy ? ` by ${request.resolvedBy}` : ""}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {resolutionActions.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    onClick={() => handleResolve(request.id, action.status)}
                    disabled={
                      activeRequestId === request.id || request.status === action.status
                    }
                    className="button-outline px-4 py-2 text-xs disabled:opacity-60"
                  >
                    {action.label}
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

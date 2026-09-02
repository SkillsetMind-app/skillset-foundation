"use client";

import { useEffect, useState } from "react";

import type { CreatorVerificationCase } from "@/domain/creator-verification";
import {
  reviewCreatorVerification,
  subscribeToVerificationQueue,
} from "@/lib/data/creator-verification";

type ReviewDecision = "approved" | "needs_changes" | "rejected";

const decisionLabels: Record<ReviewDecision, string> = {
  approved: "Approve",
  needs_changes: "Request changes",
  rejected: "Reject",
};

const decisionSuccess: Record<ReviewDecision, string> = {
  approved: "Creator approved — their professional badge is active.",
  needs_changes: "Application returned to the creator with your note.",
  rejected: "Application rejected with your note.",
};

function formatSubmittedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Pending timestamp";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function CreatorVerificationQueue() {
  const [cases, setCases] = useState<CreatorVerificationCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    return subscribeToVerificationQueue(
      (nextCases) => {
        setCases(nextCases);
        setIsLoading(false);
      },
      () => {
        setError("We could not load the verification queue.");
        setIsLoading(false);
      },
    );
  }, []);

  async function handleReview(caseId: string, decision: ReviewDecision) {
    const note = reviewNotes[caseId]?.trim() ?? "";

    if (decision !== "approved" && note.length < 12) {
      setError(
        "Add a clear review note (at least 12 characters) before requesting changes or rejecting.",
      );
      return;
    }

    setError("");
    setSuccess("");
    setActiveCaseId(caseId);

    try {
      await reviewCreatorVerification(caseId, decision, note || null);
      // The reviewed row leaves the pending realtime filter, so the change
      // event may not reach this channel — drop it locally.
      setCases((currentCases) =>
        currentCases.filter((currentCase) => currentCase.id !== caseId),
      );
      setSuccess(decisionSuccess[decision]);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "We could not record this decision. Please try again.",
      );
    } finally {
      setActiveCaseId(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Creator verification queue
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            Professional admission applications
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Check the registration against the official registry, then approve, request
            changes, or reject.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {cases.length} pending
        </span>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      {success ? <p className="mt-5 info-notice">{success}</p> : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading verification queue...
          </p>
        ) : cases.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No verification applications are waiting right now.
          </p>
        ) : (
          cases.map((verificationCase) => (
            <article
              key={verificationCase.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {verificationCase.profession}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {verificationCase.applicantName
                      ?? verificationCase.applicantEmail
                      ?? verificationCase.creatorId}
                  </h4>
                  {verificationCase.applicantEmail ? (
                    <p className="text-xs text-[var(--color-ink-soft)]">
                      {verificationCase.applicantEmail}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {formatSubmittedAt(verificationCase.createdAt)}
                </span>
              </div>

              <div className="mt-4 grid gap-2 rounded-[14px] border fine-rule bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                  {verificationCase.registrationType} —{" "}
                  {verificationCase.registrationId} (
                  {verificationCase.registrationRegion})
                </p>
                {verificationCase.evidenceLinks.length > 0 ? (
                  verificationCase.evidenceLinks.map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs font-semibold text-[var(--color-primary)] underline"
                    >
                      {link}
                    </a>
                  ))
                ) : (
                  <p className="text-xs text-[var(--color-ink-soft)]">
                    No evidence links attached.
                  </p>
                )}
                {verificationCase.note ? (
                  <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                    Applicant note: {verificationCase.note}
                  </p>
                ) : null}
              </div>

              <label className="mt-4 grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Review note to creator
                <textarea
                  value={reviewNotes[verificationCase.id] ?? ""}
                  onChange={(event) =>
                    setReviewNotes((currentNotes) => ({
                      ...currentNotes,
                      [verificationCase.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Example: The registry lookup link does not show this registration number — attach the official lookup page."
                  className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />
                <span className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
                  Required when requesting changes or rejecting. Optional when
                  approving.
                </span>
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                {(Object.keys(decisionLabels) as ReviewDecision[]).map(
                  (decision) => (
                    <button
                      key={decision}
                      type="button"
                      onClick={() =>
                        handleReview(verificationCase.id, decision)
                      }
                      disabled={activeCaseId === verificationCase.id}
                      className={
                        decision === "approved"
                          ? "button-solid px-4 py-2 text-xs disabled:opacity-60"
                          : "button-outline px-4 py-2 text-xs disabled:opacity-60"
                      }
                    >
                      {activeCaseId === verificationCase.id
                        ? "Updating..."
                        : decisionLabels[decision]}
                    </button>
                  ),
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

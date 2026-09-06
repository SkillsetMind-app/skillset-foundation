"use client";

import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Field, InlineAlert } from "@/components/ui";
import type { CreatorVerificationCase } from "@/domain/creator-verification";
import {
  reviewCreatorVerification,
  subscribeToVerificationQueue,
} from "@/lib/data/creator-verification";

type ReviewDecision = "approved" | "needs_changes" | "rejected";

const decisions: ReviewDecision[] = ["approved", "needs_changes", "rejected"];
const copy = "platform.ops.verificationQueue";

function formatSubmittedAt(iso: string, locale: string, pendingLabel: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return pendingLabel;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function CreatorVerificationQueue({ query = "" }: { query?: string }) {
  const { locale, t } = useTranslation();
  const [cases, setCases] = useState<CreatorVerificationCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const [success, setSuccess] = useState<ReviewDecision | null>(null);
  const [invalidNoteCaseId, setInvalidNoteCaseId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const normalizedQuery = query.toLowerCase().trim();
  const visibleCases = useMemo(
    () => cases.filter((verificationCase) => [
      verificationCase.id, verificationCase.creatorId, verificationCase.applicantName,
      verificationCase.applicantEmail, verificationCase.profession,
      verificationCase.registrationType, verificationCase.registrationId,
      verificationCase.registrationRegion, verificationCase.note,
      ...verificationCase.evidenceLinks,
    ].join(" ").toLowerCase().includes(normalizedQuery)),
    [cases, normalizedQuery],
  );

  useEffect(() => {
    return subscribeToVerificationQueue(
      (nextCases) => {
        setCases(nextCases);
        setLoadError(false);
        setIsLoading(false);
      },
      () => {
        setLoadError(true);
        setIsLoading(false);
      },
    );
  }, []);

  async function handleReview(caseId: string, decision: ReviewDecision) {
    const note = reviewNotes[caseId]?.trim() ?? "";
    setReviewError(false);
    setSuccess(null);

    if (decision !== "approved" && note.length < 12) {
      setInvalidNoteCaseId(caseId);
      return;
    }

    setInvalidNoteCaseId(null);
    setActiveCaseId(caseId);

    try {
      await reviewCreatorVerification(caseId, decision, note || null);
      // The reviewed row leaves the pending realtime filter, so the change
      // event may not reach this channel — drop it locally.
      setCases((currentCases) =>
        currentCases.filter((currentCase) => currentCase.id !== caseId),
      );
      setSuccess(decision);
    } catch {
      setReviewError(true);
    } finally {
      setActiveCaseId(null);
    }
  }

  return (
    <section className="min-w-0 break-words rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("platform.ops.verification")}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {isLoading ? t("platform.queueCount.loading") : loadError ? t("platform.queueCount.unavailable")
            : t(`${copy}.${cases.length === 1 ? "countOne" : "count"}`).replace("{count}", String(cases.length))}
        </span>
      </div>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {reviewError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.reviewError`)}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" className="mt-5">{t(`${copy}.success.${success}`)}</InlineAlert> : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        ) : loadError ? null : visibleCases.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.${cases.length === 0 ? "empty" : "noResults"}`)}
          </p>
        ) : (
          visibleCases.map((verificationCase) => (
            <article
              key={verificationCase.id}
              className="min-w-0 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
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
                  {formatSubmittedAt(verificationCase.createdAt, locale, t(`${copy}.pendingTimestamp`))}
                </span>
              </div>

              <div className="mt-4 grid min-w-0 gap-2 rounded-[14px] border fine-rule bg-white p-4">
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
                      className="break-all text-xs font-semibold text-[var(--color-primary)] underline"
                    >
                      {link}
                    </a>
                  ))
                ) : (
                  <p className="text-xs text-[var(--color-ink-soft)]">
                    {t(`${copy}.noEvidence`)}
                  </p>
                )}
                {verificationCase.note ? (
                  <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                    {t(`${copy}.applicantNote`).replace("{note}", () => verificationCase.note ?? "")}
                  </p>
                ) : null}
              </div>

              <Field
                id={`verification-note-${verificationCase.id}`}
                label={t(`${copy}.reviewLabel`)}
                hint={t(`${copy}.reviewHint`)}
                error={invalidNoteCaseId === verificationCase.id ? t(`${copy}.noteRequired`) : undefined}
                className="mt-4 min-w-0"
              >
                {(a11y) => <textarea
                  {...a11y}
                  value={reviewNotes[verificationCase.id] ?? ""}
                  onChange={(event) =>
                    setReviewNotes((currentNotes) => ({
                      ...currentNotes,
                      [verificationCase.id]: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder={t(`${copy}.reviewPlaceholder`)}
                  className="min-w-0 resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                />}
              </Field>

              <div className="mt-4 flex flex-wrap gap-2">
                {decisions.map(
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
                          ? "button-solid max-w-full whitespace-normal px-4 py-2 text-xs disabled:opacity-60"
                          : "button-outline max-w-full whitespace-normal px-4 py-2 text-xs disabled:opacity-60"
                      }
                    >
                      {activeCaseId === verificationCase.id
                        ? t(`${copy}.updating`)
                        : t(`${copy}.decisions.${decision}`)}
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

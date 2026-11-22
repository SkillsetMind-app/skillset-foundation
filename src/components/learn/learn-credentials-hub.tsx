"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import {
  type Certificate,
  getCredentialCandidate,
  type CredentialCandidate,
} from "@/domain/certificate";
import type { Enrollment } from "@/domain/enrollment";
import {
  issueSkillsetCertificate,
  subscribeToUserCertificates,
} from "@/lib/data/certificates";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";

export function LearnCredentialsHub() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [certificatesReady, setCertificatesReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setIsLoading(false);
      },
      () => {
        setError("learnWave2.credentials.loadError");
        setIsLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserCertificates(
      user.uid,
      (nextCertificates) => {
        setCertificates(nextCertificates);
        setCertificatesReady(true);
      },
      () => {
        setError("learnWave2.credentials.certificatesError");
        setCertificatesReady(true);
      },
    );
  }, [user]);

  const candidates = useMemo(
    () => enrollments.map((enrollment) => {
      const certificate =
        certificates.find((item) => item.enrollmentId === enrollment.id) ?? null;

      return getCredentialCandidate(enrollment, certificate);
    }),
    [certificates, enrollments],
  );
  const eligibleCount = candidates.filter((candidate) => candidate.status === "eligible").length;
  const issuedCount = candidates.filter((candidate) => candidate.status === "issued").length;
  const inProgressCount = candidates.filter((candidate) => candidate.status === "in_progress").length;
  const [activeFilter, setActiveFilter] = useState<"all" | "issued" | "eligible" | "in_progress">("all");
  const visibleCandidates = activeFilter === "all"
    ? candidates
    : candidates.filter((candidate) => candidate.status === activeFilter);

  if (isLoading || !certificatesReady) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("learnWave2.credentials.loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p role="alert" className="rounded-md bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      </section>
    );
  }

  if (candidates.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.credentials.brand")}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
          {t("learnWave2.credentials.emptyTitle")}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learnWave2.credentials.emptyDetail")}
        </p>
        <div className="mt-6">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            {t("learnWave2.credentials.explore")}
          </Link>
        </div>
      </section>
    );
  }

  // Um cabeçalho só, o do shell (o h1 da página). Antes vinham mais dois por
  // cima dos cartões: um destaque com três quadros de números e o título da
  // seção, e os filtros logo abaixo repetiam as mesmas contagens.
  return (
    <div className="grid gap-5">
      <div>
        <div className="credential-filter-tabs" role="group" aria-label={t("learnWave2.credentials.filters")}>
          {[
            ["all", t("learnWave2.credentials.all").replace("{count}", () => new Intl.NumberFormat(locale).format(candidates.length))],
            ["issued", t("learnWave2.credentials.issuedCount").replace("{count}", () => new Intl.NumberFormat(locale).format(issuedCount))],
            ["eligible", t("learnWave2.credentials.readyCount").replace("{count}", () => new Intl.NumberFormat(locale).format(eligibleCount))],
            ["in_progress", t("learnWave2.credentials.progressCount").replace("{count}", () => new Intl.NumberFormat(locale).format(inProgressCount))],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeFilter === value}
              className={activeFilter === value ? "is-active" : undefined}
              onClick={() => setActiveFilter(value as typeof activeFilter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleCandidates.length ? (
          visibleCandidates.map((candidate) => (
            <CredentialCard key={candidate.enrollmentId} candidate={candidate} />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 lg:col-span-2">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("learnWave2.credentials.noMatch")}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("learnWave2.credentials.noMatchDetail")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Exact refusals raised by issue_skillset_certificate. Anything else stays the
// generic message, so no raw database text reaches the learner.
const issueErrorKeys = new Map([
  ["This certificate was revoked by Skillset operations.", "learnWave2.credentials.revokedDetail"],
  ["This enrollment is not eligible for certificate issuance.", "learnWave2.credentials.unavailableDetail"],
  ["Complete the course before requesting a certificate.", "learnWave2.credentials.progressDetail"],
  ["RATE_LIMIT", "learnWave2.credentials.rateLimit"],
  ["RATE_LIMIT: too many attempts, please wait before trying again", "learnWave2.credentials.rateLimit"],
]);

function issueErrorKey(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  return (typeof message === "string" && issueErrorKeys.get(message)) || "learnWave2.credentials.issueError";
}

function CredentialCard({ candidate }: { candidate: CredentialCandidate }) {
  const { t, locale } = useTranslation();
  const isEligible = candidate.status === "eligible";
  const isIssued = candidate.status === "issued";
  const isUnavailable = candidate.status === "unavailable";
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [isNaming, setIsNaming] = useState(false);
  const [fullName, setFullName] = useState("");

  async function handleIssue() {
    const trimmedName = fullName.replace(/\s+/g, " ").trim();

    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setIssueError(
        "learnWave2.credentials.nameError",
      );
      return;
    }

    setIssueError("");
    setIsIssuing(true);

    try {
      await issueSkillsetCertificate(candidate.enrollmentId, trimmedName);
      // The certificates subscription flips this card to "issued" on success.
    } catch (error) {
      setIssueError(issueErrorKey(error));
    } finally {
      setIsIssuing(false);
    }
  }

  // O estado uma vez: um selo e a barra com o número no fim da linha. Antes o
  // cartão dizia o progresso três ou quatro vezes (selo, frase, quadro
  // "PROGRESS" com ícone, barra e um "40%" de 24px). A frase só fica quando há
  // algo a fazer ou a explicar: pronto para emitir, revogado, sem acesso.
  const percent = Math.max(0, Math.min(100, candidate.progressPercent));
  const detailKey = isEligible
    ? "learnWave2.credentials.eligibleDetail"
    : candidate.status === "revoked"
      ? "learnWave2.credentials.revokedDetail"
      : isUnavailable
        ? "learnWave2.credentials.unavailableDetail"
        : null;

  return (
    <article className="rounded-lg border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold leading-6 text-[var(--color-primary)]">
          {candidate.courseTitle}
        </h2>
        <span className="shrink-0 rounded-md bg-[var(--color-surface-soft)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-primary)]">
          {t(`learnWave2.credentialStatus.${candidate.status}`)}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2.5">
        <div
          role="progressbar"
          aria-label={t("learnWave2.credentials.progress")}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]"
        >
          <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-xs font-bold tabular-nums text-[var(--color-ink-soft)]">
          {new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(candidate.progressPercent / 100)}
        </span>
      </div>
      {detailKey ? (
        <p className="mt-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(detailKey)}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {/* Access ended: the classroom would refuse the learner anyway. */}
        {isUnavailable ? null : (
          <Link
            href={`/learn/courses/${candidate.courseSlug}`}
            className={isEligible ? "button-outline px-4 py-2.5 text-sm" : "button-solid px-4 py-2.5 text-sm"}
          >
            {isEligible ? t("learnWave2.credentials.review") : t("learnWave2.credentials.continue")}
          </Link>
        )}
        {isEligible && !isNaming ? (
          <button
            type="button"
            onClick={() => setIsNaming(true)}
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("learnWave2.credentials.issue")}
          </button>
        ) : null}
        {isIssued && candidate.certificateId ? (
          <Link
            href={`/learn/credentials/${candidate.certificateId}`}
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("learnWave2.credentials.view")}
          </Link>
        ) : null}
        {isIssued ? (
          <Link
            href={`/verify?code=${encodeURIComponent(candidate.verificationCode ?? "")}`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("learnWave2.credentials.verify")}
          </Link>
        ) : null}
      </div>
      {isEligible && isNaming ? (
        <div className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("learnWave2.credentials.fullName")}
            <input
              value={fullName}
              maxLength={120}
              autoFocus
              onChange={(event) => setFullName(event.target.value)}
              placeholder={t("learnWave2.credentials.namePlaceholder")}
              className="rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("learnWave2.credentials.immutable")}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleIssue}
              disabled={isIssuing}
              className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isIssuing ? t("learnWave2.credentials.issuing") : t("learnWave2.credentials.confirm")}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsNaming(false);
                setIssueError("");
              }}
              disabled={isIssuing}
              className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {t("learnWave2.credentials.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {issueError ? (
        <p role="alert" className="mt-3 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(issueError)}
        </p>
      ) : null}
    </article>
  );
}

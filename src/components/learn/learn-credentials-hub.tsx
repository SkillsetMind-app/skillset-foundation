"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Award,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

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
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("learnWave2.credentials.loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p role="alert" className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      </section>
    );
  }

  if (candidates.length === 0) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.credentials.brand")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
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

  return (
    <div className="grid gap-8">
      <section className="credential-hero dash-card dash-card--strong p-5 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              {t("learnWave2.credentials.brand")}
            </p>
            <h2 className="display-title mt-3 max-w-3xl text-3xl leading-[1.03] text-[var(--color-primary)] sm:text-4xl">
              {t("learnWave2.credentials.title")}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-ink-soft)]">
              {t("learnWave2.credentials.description")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
            <CredentialMetric
              icon={Award}
              label={t("learnWave2.credentials.tracks")}
              value={new Intl.NumberFormat(locale).format(candidates.length)}
            />
            <CredentialMetric
              icon={Clock3}
              label={t("learnWave2.credentials.ready")}
              value={new Intl.NumberFormat(locale).format(eligibleCount)}
            />
            <CredentialMetric
              icon={ShieldCheck}
              label={t("learnWave2.credentials.issued")}
              value={new Intl.NumberFormat(locale).format(issuedCount)}
            />
          </div>
        </div>
      </section>

      <section className="dash-card dash-card--strong p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("learnWave2.credentials.tracksTitle")}
            </p>
            <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              {t("learnWave2.credentials.progressTitle")}
            </h2>
          </div>
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

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {visibleCandidates.length ? (
            visibleCandidates.map((candidate) => (
              <CredentialCard key={candidate.enrollmentId} candidate={candidate} />
            ))
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 lg:col-span-2">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {t("learnWave2.credentials.noMatch")}
              </p>
              <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
                {t("learnWave2.credentials.noMatchDetail")}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CredentialMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="credential-metric-card">
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CredentialCard({ candidate }: { candidate: CredentialCandidate }) {
  const { t, locale } = useTranslation();
  const isEligible = candidate.status === "eligible";
  const isIssued = candidate.status === "issued";
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
    } catch {
      setIssueError("learnWave2.credentials.issueError");
    } finally {
      setIsIssuing(false);
    }
  }

  return (
    <article className="credential-card rounded-[16px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {candidate.authorityLabel}
          </p>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {candidate.courseTitle}
          </h2>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t(`learnWave2.credentialStatus.${candidate.status}`)}
        </span>
      </div>
      <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
        {isEligible
          ? t("learnWave2.credentials.eligibleDetail")
          : isIssued
            ? t("learnWave2.credentials.issuedDetail")
          : t("learnWave2.credentials.progressDetail")}
      </p>
      <div className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            {t("learnWave2.credentials.progress")}
          </p>
          <CheckCircle2
            aria-hidden="true"
            size={16}
            className={isIssued ? "text-[var(--color-success-fg)]" : "text-[var(--color-primary-light)]"}
          />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${Math.max(0, Math.min(100, candidate.progressPercent))}%` }}
          />
        </div>
        <p className="mt-3 text-2xl font-semibold text-[var(--color-primary)]">
          {new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(candidate.progressPercent / 100)}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={`/learn/courses/${candidate.courseSlug}`}
          className={isEligible ? "button-outline px-4 py-2.5 text-sm" : "button-solid px-4 py-2.5 text-sm"}
        >
          {isEligible ? t("learnWave2.credentials.review") : t("learnWave2.credentials.continue")}
        </Link>
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
        <div className="mt-4 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("learnWave2.credentials.fullName")}
            <input
              value={fullName}
              maxLength={120}
              autoFocus
              onChange={(event) => setFullName(event.target.value)}
              placeholder={t("learnWave2.credentials.namePlaceholder")}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
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
        <p role="alert" className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(issueError)}
        </p>
      ) : null}
    </article>
  );
}

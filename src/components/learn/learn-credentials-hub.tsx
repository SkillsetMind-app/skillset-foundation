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

import { useAuth } from "@/components/auth/auth-provider";
import {
  type Certificate,
  getCertificateStatusLabel,
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
        setError("We could not load your credential records.");
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
        setError("We could not load your issued certificate records.");
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
        <p className="text-sm text-[var(--color-ink-soft)]">Loading credentials...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      </section>
    );
  }

  if (candidates.length === 0) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Skillset Verified
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          Credentials appear after enrollment.
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Enroll in a course, complete the required lessons, and this area will
          show which credentials are in progress or ready for Skillset review.
        </p>
        <div className="mt-6">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            Explore programs
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
              Skillset Verified
            </p>
            <h2 className="display-title mt-3 max-w-3xl text-4xl leading-[1.03] text-[var(--color-primary)] sm:text-5xl">
              Credentials from real course progress.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-ink-soft)]">
              Completed courses become credential candidates. Issued certificates
              receive public verification codes.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
            <CredentialMetric
              icon={Award}
              label="Tracks"
              value={String(candidates.length)}
            />
            <CredentialMetric
              icon={Clock3}
              label="Ready"
              value={String(eligibleCount)}
            />
            <CredentialMetric
              icon={ShieldCheck}
              label="Issued"
              value={String(issuedCount)}
            />
          </div>
        </div>
      </section>

      <section className="dash-card dash-card--strong p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Credential tracks
            </p>
            <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              Earned and in progress.
            </h3>
          </div>
          <div className="credential-filter-tabs" role="group" aria-label="Credential filters">
            {[
              ["all", `All ${candidates.length}`],
              ["issued", `Issued ${issuedCount}`],
              ["eligible", `Ready ${eligibleCount}`],
              ["in_progress", `In progress ${inProgressCount}`],
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
                No credentials match this filter.
              </p>
              <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
                Continue course progress or switch filters to see all credential tracks.
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
        "Enter your full name (2-120 characters) as it should appear on the certificate.",
      );
      return;
    }

    setIssueError("");
    setIsIssuing(true);

    try {
      await issueSkillsetCertificate(candidate.enrollmentId, trimmedName);
      // The certificates subscription flips this card to "issued" on success.
    } catch {
      setIssueError("We could not issue this certificate yet. Please try again.");
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
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {candidate.courseTitle}
          </h3>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {getCertificateStatusLabel(candidate.status)}
        </span>
      </div>
      <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
        {isEligible
          ? "This course is complete. Issue your Skillset Verified certificate below."
          : isIssued
            ? "Your Skillset Verified certificate has been issued and is ready for verification."
          : "Complete the course to become eligible for your Skillset Verified certificate."}
      </p>
      <div className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            Progress
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
          {candidate.progressPercent}%
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={`/learn/courses/${candidate.courseSlug}`}
          className={isEligible ? "button-outline px-4 py-2.5 text-sm" : "button-solid px-4 py-2.5 text-sm"}
        >
          {isEligible ? "Review course" : "Continue course"}
        </Link>
        {isEligible && !isNaming ? (
          <button
            type="button"
            onClick={() => setIsNaming(true)}
            className="button-solid px-4 py-2.5 text-sm"
          >
            Issue certificate
          </button>
        ) : null}
        {isIssued && candidate.certificateId ? (
          <Link
            href={`/learn/credentials/${candidate.certificateId}`}
            className="button-solid px-4 py-2.5 text-sm"
          >
            View certificate
          </Link>
        ) : null}
        {isIssued ? (
          <Link
            href={`/verify?code=${encodeURIComponent(candidate.verificationCode ?? "")}`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            Verify credential
          </Link>
        ) : null}
      </div>
      {isEligible && isNaming ? (
        <div className="mt-4 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Full name on certificate
            <input
              value={fullName}
              maxLength={120}
              autoFocus
              onChange={(event) => setFullName(event.target.value)}
              placeholder="e.g. Maria Aparecida da Silva"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            This is printed on your certificate and can&apos;t be changed after issuance.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleIssue}
              disabled={isIssuing}
              className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isIssuing ? "Issuing..." : "Confirm & issue"}
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
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {issueError ? (
        <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {issueError}
        </p>
      ) : null}
    </article>
  );
}

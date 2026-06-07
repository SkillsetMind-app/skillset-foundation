import Image from "next/image";

import type { Certificate } from "@/domain/certificate";

/**
 * Presentational, print-optimized certificate. Renders only from a `Certificate`
 * snapshot (no live lookups), so what prints is exactly the permanent record:
 * the locked learner name, the course, the teacher identity captured at
 * issuance, the Skillset authority mark, and the public verification code.
 */
export function CertificateDocument({
  certificate,
}: {
  certificate: Certificate;
}) {
  const studentName = certificate.studentFullName?.trim() || "Skillset Learner";
  const teacherName = certificate.teacherName?.trim() || "Skillset Faculty";
  const issuedOn = formatIssuedAt(certificate.issuedAt);

  return (
    <article className="cert-doc mx-auto w-full max-w-4xl bg-white text-[var(--color-ink)] shadow-[var(--shadow-soft)] print:max-w-none print:shadow-none">
      <div className="relative overflow-hidden rounded-[6px] border-[3px] border-[var(--color-primary)] p-6 sm:p-10 print:rounded-none print:border-2">
        <div
          className="pointer-events-none absolute inset-2 rounded-[4px] border border-[var(--color-line-strong)] print:inset-1"
          aria-hidden="true"
        />
        <div className="relative">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <span className="relative block h-9 w-36">
              <Image
                src="/brand/logo-full-dark.png"
                alt="Skillset"
                fill
                sizes="160px"
                className="object-contain object-left"
              />
            </span>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
                {certificate.authorityLabel}
              </p>
              <p className="text-xs font-semibold text-[var(--color-ink-soft)]">
                Certificate of Completion
              </p>
            </div>
          </header>

          {certificate.sponsorLogoUrl ? (
            <div className="mt-5 flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
                In partnership with
              </span>
              <span className="relative block h-7 w-28">
                <Image
                  src={certificate.sponsorLogoUrl}
                  alt="Partner"
                  fill
                  sizes="120px"
                  className="object-contain object-left"
                  unoptimized
                />
              </span>
            </div>
          ) : null}

          <div className="mt-8 text-center sm:mt-10">
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-ink-soft)]">
              This certifies that
            </p>
            <h1 className="display-title mt-3 text-4xl text-[var(--color-primary)] sm:text-5xl">
              {studentName}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
              has successfully completed the Skillset program
            </p>
            <h2 className="display-title mt-3 text-2xl text-[var(--color-ink)] sm:text-3xl">
              {certificate.courseTitle}
            </h2>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--color-brand)]">
              {certificate.courseCategory}
            </p>
          </div>

          <footer className="mt-10 grid gap-6 sm:mt-12 sm:grid-cols-2 sm:items-end">
            <div className="text-center sm:text-left">
              <div className="flex h-14 items-end justify-center sm:justify-start">
                {certificate.teacherSignatureUrl ? (
                  <span className="relative block h-12 w-44">
                    <Image
                      src={certificate.teacherSignatureUrl}
                      alt={`${teacherName} signature`}
                      fill
                      sizes="176px"
                      className="object-contain object-bottom sm:object-left-bottom"
                      unoptimized
                    />
                  </span>
                ) : (
                  <span className="display-title text-3xl italic text-[var(--color-primary)]">
                    {teacherName}
                  </span>
                )}
              </div>
              <div className="mt-1 border-t border-[var(--color-ink)] pt-2">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {teacherName}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">Instructor</p>
              </div>
            </div>
            <div className="text-center sm:text-right">
              {issuedOn ? (
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  Issued {issuedOn}
                </p>
              ) : null}
              <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
                Verification code
              </p>
              <p className="font-mono text-sm font-semibold text-[var(--color-primary)]">
                {certificate.verificationCode}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-ink-soft)]">
                Verify at skillsetusaofficial.web.app/verify
              </p>
            </div>
          </footer>
        </div>
      </div>
    </article>
  );
}

function formatIssuedAt(issuedAt: unknown): string {
  const date = coerceDate(issuedAt);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function coerceDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Firestore Timestamp (client SDK) exposes toDate().
  if (typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: () => Date }).toDate;

    if (typeof toDate === "function") {
      try {
        const date = toDate.call(value);
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      } catch {
        return null;
      }
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

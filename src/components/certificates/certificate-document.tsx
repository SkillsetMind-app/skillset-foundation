import Image from "next/image";

import type { Certificate } from "@/domain/certificate";

/**
 * Presentational, print-optimized certificate. Renders only from a `Certificate`
 * snapshot (no live lookups), so what prints is exactly the permanent record:
 * the locked learner name, the course, the teacher identity captured at
 * issuance, the authority mark, and the public verification code.
 *
 * When `hidePlatformBrand` was stamped at issuance (pro and up), the teacher's
 * mark takes the header and our name disappears from the body — except the
 * verification code and its URL, which are the credential's whole point and
 * print on every certificate regardless of plan.
 */
export function CertificateDocument({
  certificate,
}: {
  certificate: Certificate;
}) {
  const hideBrand = certificate.hidePlatformBrand === true;
  const studentName =
    certificate.studentFullName?.trim() || (hideBrand ? "Learner" : "SkillsetMind Learner");
  const teacherName =
    certificate.teacherName?.trim() || (hideBrand ? "Instructor" : "SkillsetMind Faculty");
  const issuedOn = formatIssuedAt(certificate.issuedAt);

  return (
    // O certificado é um DOCUMENTO, não uma tela: é impresso, baixado em PDF e
    // compartilhado. Tem de ser claro sempre. Antes combinava bg-white fixo com
    // text-[var(--color-ink)], que no tema escuro vira tinta clara — quem já
    // tinha ligado o dark mode alguma vez abria o certificado por link direto e
    // baixava um PDF ilegível. Cores literais aqui são a escolha certa, não
    // descuido: o artefato não deve seguir o tema de quem o abre.
    <article className="cert-doc mx-auto w-full max-w-4xl bg-white text-[#102a43] print:max-w-none">
      <div className="cert-doc-frame">
        <div
          className="cert-doc-rule"
          aria-hidden="true"
        />
        <div className="cert-doc-content">
          <header className="cert-doc-header">
            {hideBrand ? (
              // Whitelabel: the teacher's mark takes the masthead. No logo on
              // file falls back to their name set as a wordmark, never to ours.
              certificate.sponsorLogoUrl ? (
                <span className="relative block h-9 w-36">
                  <Image
                    src={certificate.sponsorLogoUrl}
                    alt={teacherName}
                    fill
                    sizes="160px"
                    className="object-contain object-left"
                    unoptimized
                  />
                </span>
              ) : (
                <span className="cert-doc-wordmark">
                  {teacherName}
                </span>
              )
            ) : (
              <span className="relative block h-9 w-36">
                <Image
                  src="/brand/logo-full-dark.png"
                  alt="SkillsetMind"
                  fill
                  sizes="160px"
                  className="object-contain object-left"
                />
              </span>
            )}
            <div className="cert-doc-heading">
              {hideBrand ? null : (
                <p className="cert-doc-authority">
                  {certificate.authorityLabel}
                </p>
              )}
              <p className="cert-doc-type">
                Certificate of Completion
              </p>
            </div>
          </header>

          {/* Co-brand band, for plans that add the teacher's mark next to ours.
              Under whitelabel it is redundant: the mark is already the header. */}
          {!hideBrand && certificate.sponsorLogoUrl ? (
            <div className="cert-doc-cobrand">
              <span className="cert-doc-caption">
                Course by
              </span>
              <span className="relative block h-7 w-28">
                <Image
                  src={certificate.sponsorLogoUrl}
                  alt={teacherName}
                  fill
                  sizes="120px"
                  className="object-contain object-left"
                  unoptimized
                />
              </span>
            </div>
          ) : null}

          <div className="cert-doc-award">
            <p className="cert-doc-caption">
              This certifies that
            </p>
            <h1 className={`cert-doc-name${studentName.length > 60 ? " cert-doc-name-long" : ""}`}>
              {studentName}
            </h1>
            <p className="cert-doc-completion">
              {hideBrand
                ? "has successfully completed the program"
                : "has successfully completed the SkillsetMind program"}
            </p>
            <h2 className={`cert-doc-course${certificate.courseTitle.length > 120 ? " cert-doc-course-long" : ""}`}>
              {certificate.courseTitle}
            </h2>
            <p className="cert-doc-category">
              {certificate.courseCategory}
            </p>
          </div>

          <footer className="cert-doc-footer">
            <div className="cert-doc-instructor">
              <div className="cert-doc-signature">
                {certificate.teacherSignatureUrl ? (
                  <span className="relative block h-12 w-44">
                    <Image
                      src={certificate.teacherSignatureUrl}
                      alt={`${teacherName} signature`}
                      fill
                      sizes="176px"
                      className="object-contain object-left-bottom"
                      unoptimized
                    />
                  </span>
                ) : (
                  <span className="cert-doc-signature-fallback">
                    {teacherName}
                  </span>
                )}
              </div>
              <div className="cert-doc-signatory">
                <p className="cert-doc-teacher">
                  {teacherName}
                </p>
                <p className="cert-doc-caption">Instructor</p>
              </div>
            </div>
            <div className="cert-doc-verification">
              {issuedOn ? (
                <p className="cert-doc-issued">
                  Issued {issuedOn}
                </p>
              ) : null}
              <p className="cert-doc-caption">
                Verification code
              </p>
              <p className="cert-doc-code">
                {certificate.verificationCode}
              </p>
              <p className="cert-doc-verify-url">
                Verify at skillsetmind.com/verify
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
    timeZone: "UTC",
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

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { CertificateDocument } from "@/components/certificates/certificate-document";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import type { Certificate } from "@/domain/certificate";
import { getCertificate } from "@/lib/data/certificates";
import { SITE_URL } from "@/lib/seo/page-metadata";

type LoadState = "loading" | "ready" | "missing" | "error";

export function CertificatePrintView({
  certificateId,
}: {
  certificateId: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  // "Try again" for the read: the same one as the effect, again. The document
  // placeholder stays on screen in both outcomes and receives focus.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  // "Link copied" goes away by itself; the failure stays, so the person knows it did not work.
  useEffect(() => {
    if (copyResult !== "copied") return;
    const timer = setTimeout(() => setCopyResult(null), 2000);
    return () => clearTimeout(timer);
  }, [copyResult]);

  async function copyVerificationLink(value: Certificate) {
    try {
      await navigator.clipboard.writeText(buildVerifyUrl(value));
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  }

  useEffect(() => {
    // ProtectedSurface only mounts this view for a signed-in account with the
    // certificates.view permission, so `user` is normally present. Guard the
    // async fetch anyway and never set state synchronously in the effect body.
    if (!user) {
      return;
    }

    let active = true;

    getCertificate(certificateId)
      .then((result) => {
        if (!active) {
          return;
        }

        if (result && result.userId === user.uid && result.status === "issued") {
          setCertificate(result);
          setState("ready");
        } else {
          setState("missing");
        }
      })
      .catch(() => {
        if (active) {
          setState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [certificateId, user, loadAttempt]);

  // Back to the usual wait (the certificate paper) until the read answers.
  function retryLoad() {
    setState("loading");
    setLoadAttempt((attempt) => attempt + 1);
  }

  return (
    <main className="min-h-screen bg-[var(--color-surface)] px-5 py-10 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/learn/credentials"
          className="text-sm font-semibold text-[var(--color-primary)] underline underline-offset-2"
        >
          {t("learnWave2.print.back")}
        </Link>
        {state === "ready" && certificate ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* The public verification link, the same one that goes to LinkedIn:
                before, it could only be shared through LinkedIn. */}
            <button
              type="button"
              onClick={() => void copyVerificationLink(certificate)}
              className="button-outline px-4 py-2.5 text-sm"
            >
              {t("learnWave2.print.copyLink")}
            </button>
            <a
              href={buildLinkedInAddUrl(certificate)}
              target="_blank"
              rel="noopener noreferrer"
              className="button-outline px-4 py-2.5 text-sm"
            >
              {t("learnWave2.print.linkedIn")}
            </a>
            {/* Opens the browser print dialog (where "Save as
                PDF" lives): the label says so, not "Download PDF". */}
            <button
              type="button"
              onClick={() => window.print()}
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("learnWave2.print.download")}
            </button>
          </div>
        ) : null}
        {/* The "Link copied" line always exists, empty (reserved height,
            also while loading): nothing moves when the notice appears. */}
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 w-full text-xs font-semibold text-[var(--color-ink-soft)] sm:text-right"
        >
          {copyResult === "copied" ? t("learnWave2.print.copied") : ""}
        </p>
        {/* No access to the clipboard: the link in a field to copy
            by hand (tapping selects everything). */}
        {state === "ready" && certificate && copyResult === "failed" ? (
          <div className="w-full">
            <p role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
              {t("learnWave2.print.copyFailed")}
            </p>
            <input
              readOnly
              value={buildVerifyUrl(certificate)}
              aria-label={t("learnWave2.print.verifyLink")}
              onFocus={(event) => event.currentTarget.select()}
              className="field-input mt-2 text-base"
            />
          </div>
        ) : null}
      </div>

      <div ref={frameRef} tabIndex={-1} className="mt-6 outline-none print:mt-0">
        {/* While loading, the certificate paper already takes its place
            (same classes as the document): before, a small card turned into a
            ~850px document and the whole page jumped. */}
        {state === "loading" ? (
          <div aria-busy="true">
            <p role="status" className="sr-only">{t("learnWave2.print.loading")}</p>
            <div aria-hidden="true" className="cert-doc mx-auto min-h-[70svh] w-full max-w-4xl animate-pulse">
              <div className="cert-doc-frame">
                <div className="cert-doc-content" />
              </div>
            </div>
          </div>
        ) : null}

        {/* The certificate is the issued record: it stays in English in every interface
            language. Only the controls around it follow the locale. */}
        {state === "ready" && certificate ? (
          <CertificateDocument certificate={certificate} />
        ) : null}

        {state === "missing" ? (
          <CertificateNotice
            title={t("learnWave2.print.missing")}
            description={t("learnWave2.print.missingDetail")}
          />
        ) : null}

        {/* The old sentence told people to refresh the page; now the button reads again. */}
        {state === "error" ? (
          <CertificateNotice title={t("learnWave2.print.error")}>
            <LoadErrorAlert className="mt-4 text-left" onRetry={retryLoad} focusRef={frameRef}>
              {t("learnWave2.print.errorRetryDetail")}
            </LoadErrorAlert>
          </CertificateNotice>
        ) : null}
      </div>
    </main>
  );
}

// LinkedIn "Add to Profile" deep link for the Licenses & Certifications section.
// Points at the public verification URL so anyone (recruiters included) can confirm it.
function buildVerifyUrl(certificate: Certificate): string {
  return `${SITE_URL}/verify?code=${encodeURIComponent(certificate.verificationCode)}`;
}

function buildLinkedInAddUrl(certificate: Certificate): string {
  const verifyUrl = buildVerifyUrl(certificate);

  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: certificate.courseTitle,
    organizationName: "SkillsetMind",
    certUrl: verifyUrl,
    certId: certificate.verificationCode,
  });

  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

function CertificateNotice({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-[var(--color-line)] bg-white keep-white p-6 text-center shadow-[var(--shadow-soft)] sm:p-8">
      <h1 className="text-xl font-semibold text-[var(--color-primary)]">
        {title}
      </h1>
      {description ? (
        <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

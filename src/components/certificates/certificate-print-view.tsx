"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { CertificateDocument } from "@/components/certificates/certificate-document";
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

  // "Link copied" some sozinho; a falha fica, para a pessoa saber que não foi.
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
  }, [certificateId, user]);

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
            {/* O link público de verificação, o mesmo que vai para o LinkedIn:
                antes só dava para compartilhar pelo LinkedIn. */}
            <span
              role="status"
              aria-live="polite"
              className={`text-xs font-semibold ${copyResult === "failed" ? "text-[var(--color-danger-fg)]" : "text-[var(--color-ink-soft)]"}`}
            >
              {copyResult ? t(copyResult === "copied" ? "learnWave2.print.copied" : "learnWave2.print.copyFailed") : ""}
            </span>
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
            {/* Abre a janela de imprimir do navegador (onde fica "Salvar como
                PDF"): o rótulo diz isso, não "Download PDF". */}
            <button
              type="button"
              onClick={() => window.print()}
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("learnWave2.print.download")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 print:mt-0">
        {/* Enquanto carrega, o papel do certificado já ocupa o lugar dele
            (mesmas classes do documento): antes um cartão pequeno virava um
            documento de ~850px e a página inteira pulava. */}
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

        {state === "error" ? (
          <CertificateNotice
            title={t("learnWave2.print.error")}
            description={t("learnWave2.print.errorDetail")}
          />
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
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-[var(--color-line)] bg-white keep-white p-6 text-center shadow-[var(--shadow-soft)] sm:p-8">
      <h1 className="text-xl font-semibold text-[var(--color-primary)]">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        {description}
      </p>
    </section>
  );
}

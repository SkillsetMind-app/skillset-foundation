"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  type CertificateVerificationResult,
  verifySkillsetCertificatePublic,
} from "@/lib/data/certificates";

export function CertificateVerificationPanel() {
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") ?? "";
  const [verificationCode, setVerificationCode] = useState(initialCode);
  const [result, setResult] = useState<CertificateVerificationResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const code = verificationCode.trim();

    if (!code) {
      setError("learnWave2.verification.emptyError");
      return;
    }

    setError("");
    setResult(null);
    setIsChecking(true);

    try {
      setResult(await verifySkillsetCertificatePublic(code));
    } catch {
      setError("learnWave2.verification.verifyError");
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl rounded-[20px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] md:p-8">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("learnWave2.credentials.brand")}
      </p>
      <h1 className="display-title mt-4 text-4xl text-[var(--color-ink)] md:text-6xl">
        {t("learnWave2.verification.title")}
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)] print:hidden">
        {t("learnWave2.verification.description")}
      </p>

      <form
        className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto] print:hidden"
        onSubmit={handleVerify}
      >
        <input
          value={verificationCode}
          onChange={(event) => setVerificationCode(event.target.value)}
          aria-label={t("learnWave2.verification.codeLabel")}
          placeholder="SK-..."
          className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)]"
        />
        <button
          type="submit"
          disabled={isChecking}
          className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isChecking ? t("learnWave2.verification.checking") : t("learnWave2.verification.verify")}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      ) : null}

      {result?.valid === false ? (
        <div className="mt-6 rounded-[16px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.05)] p-5">
          <h2 className="text-lg font-semibold text-[var(--color-accent-fg)]">
            {t("learnWave2.verification.missing")}
          </h2>
          <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("learnWave2.verification.missingDetail")}
          </p>
        </div>
      ) : null}

      {result?.valid ? (
        <div className="mt-6 rounded-[16px] border border-[rgba(26,54,93,0.16)] bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("learnWave2.verification.verified")}
          </p>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {result.certificate.courseTitle}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <VerificationDetail label={t("learnWave2.verification.authority")} value={t("learnWave2.credentials.brand")} />
            <VerificationDetail label={t("learnWave2.verification.category")} value={result.certificate.courseCategory} />
            <VerificationDetail
              label={t("learnWave2.verification.issued")}
              value={
                result.certificate.issuedAt
                  ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(result.certificate.issuedAt),
                    )
                  : t("learnWave2.verification.issued")
              }
            />
          </div>
          <p className="mt-4 rounded-[10px] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
            {t("learnWave2.verification.code").replace("{code}", () => result.certificate.verificationCode)}
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="button-solid mt-5 px-4 py-2.5 text-sm print:hidden"
          >
            {t("learnWave2.verification.print")}
          </button>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3 print:hidden">
        <Link href="/" className="button-outline px-4 py-2.5 text-sm">
          {t("learnWave2.verification.back")}
        </Link>
        <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
          {t("learnWave2.verification.explore")}
        </Link>
      </div>
    </section>
  );
}

function VerificationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border fine-rule bg-white p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
        {value}
      </p>
    </div>
  );
}

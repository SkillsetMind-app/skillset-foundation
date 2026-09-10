"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  type EnrolledFactor,
  finishTotpEnrollment,
  getAuthErrorMessage,
  listEnrolledTotpFactors,
  startTotpEnrollment,
  type TotpSecret,
  unenrollTotpFactor,
} from "@/lib/auth/supabase-auth";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";

type SetupState = {
  secret: TotpSecret;
  secretKey: string;
  otpauthUrl: string;
};

/**
 * Real TOTP two-factor enrollment, gated behind the `auth.mfa` feature flag.
 * When the flag is off (default) it shows an honest "not enabled" state rather
 * than a fake QR — enabling it requires Supabase Auth MFA (TOTP) on the
 * project. The matching sign-in challenge lives in the login form, so turning
 * this on never locks anyone out.
 */
export function TotpMfaSection({ emailVerified }: { emailVerified: boolean }) {
  const { t, locale } = useTranslation();
  const mfaEnabled = isPublicFeatureEnabled("auth.mfa");
  const [factors, setFactors] = useState<EnrolledFactor[]>([]);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    { key: string } | { cause: unknown } | null
  >(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  // Remover o segundo fator é irreversível sem refazer o cadastro inteiro, e o
  // controle era um link de ~16px sem confirmação nenhuma — menos protegido que
  // "Send change confirmation", que só dispara um e-mail. Um clique errado
  // deixava a conta com senha apenas, em silêncio. Confirmação em dois passos,
  // inline: window.confirm trava a aba e é ignorável por hábito.
  const [confirmingDisable, setConfirmingDisable] = useState<string | null>(null);

  useEffect(() => {
    // Read enrolled factors once on mount. Client-side only —
    // listEnrolledTotpFactors reads the Supabase session, absent during
    // SSR/render; doing it in an effect (not lazy init) avoids a hydration
    // mismatch (server snapshot [] vs client snapshot factors).
    if (!mfaEnabled) {
      return;
    }

    let cancelled = false;
    void listEnrolledTotpFactors().then((enrolled) => {
      if (!cancelled) {
        setFactors(enrolled);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mfaEnabled]);

  const isEnrolled = factors.length > 0;

  async function handleStart() {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      setSetup(await startTotpEnrollment());
      setCode("");
    } catch (caught) {
      setError({ cause: caught });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!setup || code.trim().length < 6) {
      setError({ key: "accountSecurity.mfa.codeRequired" });
      return;
    }
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await finishTotpEnrollment(setup.secret, code, "Authenticator app");
      setFactors(await listEnrolledTotpFactors());
      setSetup(null);
      setCode("");
      setMessage("accountSecurity.mfa.enabled");
    } catch (caught) {
      setError({ cause: caught });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(factorUid: string) {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await unenrollTotpFactor(factorUid);
      setFactors(await listEnrolledTotpFactors());
      setMessage("accountSecurity.mfa.disabled");
    } catch (caught) {
      setError({ cause: caught });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyKey() {
    if (!setup) {
      return;
    }
    try {
      await navigator.clipboard.writeText(setup.secretKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions / insecure context) — the key is
      // visible on screen for manual entry regardless, so this is non-fatal.
      setCopied(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--color-ink)]">
            {t("accountSecurity.mfa.title")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountSecurity.mfa.description")}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
            isEnrolled
              ? "bg-[var(--color-success-soft)] text-[var(--color-success-fg)]"
              : "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
          }`}
        >
          {isEnrolled ? <ShieldCheck size={12} aria-hidden /> : null}
          {t(isEnrolled ? "accountSecurity.mfa.on" : "accountSecurity.mfa.off")}
        </span>
      </div>

      {/* Flag off: honest unavailable state, never a fake setup. */}
      {!mfaEnabled ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("accountSecurity.mfa.unavailable")}
        </p>
      ) : !emailVerified && !isEnrolled ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("accountSecurity.mfa.verifyEmail")}
        </p>
      ) : isEnrolled ? (
        <div className="mt-4 grid gap-3">
          {factors.map((factor) => (
            <div
              key={factor.uid}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3"
            >
              <div className="text-sm">
                <p className="font-semibold text-[var(--color-ink)]">
                  {!factor.displayName || factor.displayName === "Authenticator app"
                    ? t("accountSecurity.mfa.authenticator")
                    : factor.displayName}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  {t("accountSecurity.mfa.enrolled").replace("{date}", () =>
                    factor.enrolledAt
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                        }).format(new Date(factor.enrolledAt))
                      : "",
                  )}
                </p>
              </div>
              {confirmingDisable === factor.uid ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--color-ink-soft)]">
                    {t("accountSecurity.mfa.disableConfirm")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDisable(null);
                      void handleDisable(factor.uid);
                    }}
                    disabled={busy}
                    className="min-h-[32px] rounded-md border border-[var(--color-danger)] px-3 text-xs font-bold text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
                  >
                    {t("accountSecurity.mfa.confirmDisable")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisable(null)}
                    disabled={busy}
                    className="min-h-[32px] px-2 text-xs font-bold text-[var(--color-ink-soft)] underline-offset-2 hover:underline disabled:opacity-60"
                  >
                    {t("accountSecurity.mfa.keepEnabled")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDisable(factor.uid)}
                  disabled={busy}
                  className="min-h-[32px] px-2 text-xs font-bold text-[var(--color-danger)] underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {t("accountSecurity.mfa.disable")}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : setup ? (
        <div className="mt-4 grid gap-4">
          <ol className="grid gap-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            <li>
              <strong className="text-[var(--color-ink)]">1.</strong>{" "}
              {t("accountSecurity.mfa.step1")}
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">2.</strong>{" "}
              {t("accountSecurity.mfa.step2BeforeLink")}{" "}
              <a
                href={setup.otpauthUrl}
                className="font-semibold text-[var(--color-primary)] hover:underline"
              >
                {t("accountSecurity.mfa.setupLink")}
              </a>{" "}
              {t("accountSecurity.mfa.step2AfterLink")}
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">3.</strong>{" "}
              {t("accountSecurity.mfa.step3")}
            </li>
          </ol>

          <div className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
              {t("accountSecurity.mfa.setupKey")}
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="break-all font-mono text-sm tracking-wide text-[var(--color-ink)]">
                {setup.secretKey}
              </code>
              <button
                type="button"
                onClick={handleCopyKey}
                className="shrink-0 text-xs font-bold text-[var(--color-primary)] hover:underline"
              >
                {t(copied ? "accountSecurity.mfa.copied" : "accountSecurity.mfa.copy")}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                {t("accountSecurity.mfa.code")}
              </span>
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder={t("accountSecurity.mfa.codePlaceholder")}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t("accountSecurity.mfa.codeLabel")}
                className="w-32 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-center font-mono text-base tracking-[0.3em] outline-none focus:border-[var(--color-primary-light)]"
              />
            </label>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || code.length < 6}
              className="button-solid px-3.5 py-2.5 text-xs disabled:opacity-60"
            >
              {t(busy ? "accountSecurity.mfa.verifying" : "accountSecurity.mfa.enable")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode("");
                setError(null);
              }}
              disabled={busy}
              className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] disabled:opacity-60"
            >
              {t("accountSecurity.mfa.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className="button-outline mt-4 px-3.5 py-2 text-xs disabled:opacity-60"
        >
          {t(busy ? "accountSecurity.mfa.preparing" : "accountSecurity.mfa.setup")}
        </button>
      )}

      {message ? (
        <p className="mt-3 text-sm font-semibold text-[var(--color-success-fg)]">
          {t(message)}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {"key" in error ? t(error.key) : getAuthErrorMessage(error.cause, t)}
        </p>
      ) : null}
    </div>
  );
}

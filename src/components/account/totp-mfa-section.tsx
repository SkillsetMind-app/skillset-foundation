"use client";

import { ShieldCheck } from "lucide-react";
import type { MultiFactorInfo, TotpSecret } from "firebase/auth";
import { useEffect, useState } from "react";

import {
  finishTotpEnrollment,
  getAuthErrorMessage,
  listEnrolledTotpFactors,
  startTotpEnrollment,
  unenrollTotpFactor,
} from "@/lib/auth/firebase-auth";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";

type SetupState = {
  secret: TotpSecret;
  secretKey: string;
  otpauthUrl: string;
};

/**
 * Real TOTP two-factor enrollment, gated behind the `auth.mfa` feature flag.
 * When the flag is off (default) it shows an honest "not enabled" state rather
 * than a fake QR — enabling it requires Firebase Identity Platform (MFA) on the
 * project. The matching sign-in challenge lives in the login form, so turning
 * this on never locks anyone out.
 */
export function TotpMfaSection({ emailVerified }: { emailVerified: boolean }) {
  const mfaEnabled = isPublicFeatureEnabled("auth.mfa");
  const [factors, setFactors] = useState<MultiFactorInfo[]>([]);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Read enrolled factors once on mount. This MUST run client-side only —
    // listEnrolledTotpFactors reads Firebase auth.currentUser, which is null
    // during SSR/render; doing it in an effect (not lazy init) avoids a
    // hydration mismatch (server snapshot [] vs client snapshot factors).
    if (mfaEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFactors(listEnrolledTotpFactors());
    }
  }, [mfaEnabled]);

  const isEnrolled = factors.length > 0;

  async function handleStart() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setSetup(await startTotpEnrollment());
      setCode("");
    } catch (caught) {
      setError(getAuthErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!setup || code.trim().length < 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await finishTotpEnrollment(setup.secret, code, "Authenticator app");
      setFactors(listEnrolledTotpFactors());
      setSetup(null);
      setCode("");
      setMessage("Two-factor authentication is on. Your account is protected.");
    } catch (caught) {
      setError(getAuthErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(factorUid: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await unenrollTotpFactor(factorUid);
      setFactors(listEnrolledTotpFactors());
      setMessage("Two-factor authentication turned off.");
    } catch (caught) {
      setError(getAuthErrorMessage(caught));
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
            Two-factor authentication
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            Add a code from an authenticator app on top of your password.
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
          {isEnrolled ? "On" : "Off"}
        </span>
      </div>

      {/* Flag off: honest unavailable state, never a fake setup. */}
      {!mfaEnabled ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          Two-factor authentication isn&rsquo;t enabled on this workspace yet.
          Once it&rsquo;s switched on, you&rsquo;ll set up an authenticator app
          right here.
        </p>
      ) : !emailVerified && !isEnrolled ? (
        <p className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          Verify your email above before enabling two-factor authentication.
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
                  {factor.displayName || "Authenticator app"}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  Enrolled{" "}
                  {factor.enrollmentTime
                    ? new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                      }).format(new Date(factor.enrollmentTime))
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDisable(factor.uid)}
                disabled={busy}
                className="text-xs font-bold text-[var(--color-accent-fg)] underline-offset-2 hover:underline disabled:opacity-60"
              >
                Turn off
              </button>
            </div>
          ))}
        </div>
      ) : setup ? (
        <div className="mt-4 grid gap-4">
          <ol className="grid gap-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            <li>
              <strong className="text-[var(--color-ink)]">1.</strong> Open your
              authenticator app (Google Authenticator, Authy, 1Password…).
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">2.</strong> Add an
              account, then{" "}
              <a
                href={setup.otpauthUrl}
                className="font-semibold text-[var(--color-primary)] hover:underline"
              >
                open this setup link
              </a>{" "}
              or enter the key below by hand.
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">3.</strong> Type the
              6-digit code it shows.
            </li>
          </ol>

          <div className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
              Setup key
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
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                6-digit code
              </span>
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Authenticator code"
                className="w-32 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-center font-mono text-base tracking-[0.3em] outline-none focus:border-[var(--color-primary-light)]"
              />
            </label>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || code.length < 6}
              className="button-solid px-3.5 py-2.5 text-xs disabled:opacity-60"
            >
              {busy ? "Verifying..." : "Turn on 2FA"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode("");
                setError("");
              }}
              disabled={busy}
              className="text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] disabled:opacity-60"
            >
              Cancel
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
          {busy ? "Preparing..." : "Set up authenticator"}
        </button>
      )}

      {message ? (
        <p className="mt-3 text-sm font-semibold text-[var(--color-success-fg)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

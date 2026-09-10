"use client";

import { useState } from "react";

import { TotpMfaSection } from "@/components/account/totp-mfa-section";
import { useAuth } from "@/components/auth/auth-provider";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  changeSkillsetPassword,
  getAuthErrorMessage,
  isEmailRateLimitError,
  isMultiFactorRequiredError,
  requestSkillsetEmailChange,
  refreshCurrentUserEmailVerification,
  resetPassword,
  sendSkillsetEmailVerification,
} from "@/lib/auth/supabase-auth";

export function SecuritySettingsPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified ?? false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<
    { key: string } | { cause: unknown } | null
  >(null);
  // Both password actions below go through GoTrue endpoints that CAPTCHA
  // protection guards (a password sign-in to re-authenticate, and the reset
  // email). Same widget as the login form: with no site key it renders nothing
  // and the token stays "", so with CAPTCHA off nothing here changes; with it
  // on, the token rides along instead of the calls dead-ending on "captcha
  // protection: request disallowed" with no widget in sight.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;

  // Every handler here writes into the shared message/error pair, but both are
  // rendered after the card grid AND after the two-factor card — which below
  // `lg` is a full-width block sitting between the button you pressed and the
  // answer. "Email me a reset link" is the worst case: the link fires, the mail
  // arrives, and nothing visibly happens. Each handler clears the pair before
  // its await and writes after, so the paragraph genuinely unmounts and
  // remounts on every attempt and this callback ref fires each time.
  const revealFeedback = (node: HTMLParagraphElement | null) => {
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const passwordReady = isStrongPassword(nextPassword);

  async function handleSendVerification() {
    setIsBusy(true);
    setError(null);
    setMessage("");

    try {
      await sendSkillsetEmailVerification();
      setMessage("accountSecurity.verification.sent");
    } catch {
      setError({ key: "accountSecurity.verification.sendError" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshVerification() {
    setIsBusy(true);
    setError(null);
    setMessage("");

    try {
      const verified = await refreshCurrentUserEmailVerification();
      setEmailVerified(verified);
      setMessage(
        verified
          ? "accountSecurity.verification.confirmed"
          : "accountSecurity.verification.pending",
      );
    } catch {
      setError({ key: "accountSecurity.verification.refreshError" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEmailChangeRequest() {
    setIsBusy(true);
    setError(null);
    setMessage("");

    try {
      await requestSkillsetEmailChange(newEmail);
      setMessage("accountSecurity.email.sent");
      setNewEmail("");
    } catch (caughtError) {
      setError({ cause: caughtError });
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePasswordChangeRequest() {
    if (!passwordReady) {
      setError({ key: "accountSecurity.password.requirementsError" });
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage("");

    try {
      await changeSkillsetPassword(
        currentPassword,
        nextPassword,
        captchaToken || undefined,
      );
      setCurrentPassword("");
      setNextPassword("");
      setMessage("accountSecurity.password.updated");
    } catch (caughtError) {
      // Re-authentication for a 2FA user triggers an MFA challenge this form
      // can't resolve. The reset-link path below sets a new password without
      // re-auth, so steer them there instead of showing a code prompt with no
      // field.
      if (isMultiFactorRequiredError(caughtError)) {
        setError({ key: "accountSecurity.password.mfaResetHint" });
      } else {
        setError({ cause: caughtError });
      }
    } finally {
      // Turnstile tokens are single-use — refresh for the next attempt.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsBusy(false);
    }
  }

  // Recovery path for a signed-in user who forgot their CURRENT password and
  // therefore can't use the change-password form (which re-authenticates).
  // Supabase emails a secure reset link — the password is never exposed and
  // no current password is required.
  async function handleSendPasswordReset() {
    if (!user?.email) {
      setError({ key: "accountSecurity.password.noEmail" });
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage("");

    try {
      await resetPassword(user.email, captchaToken || undefined);
      setMessage("accountSecurity.password.resetSent");
    } catch (caughtError) {
      // Same call, same limit, same confusion as the reset page: hitting the
      // send cap means an earlier link already went out, so "Too many
      // attempts" points people at a failure that never happened.
      if (isEmailRateLimitError(caughtError)) {
        setMessage("accountSecurity.password.resetLimited");
      } else {
        setError({ cause: caughtError });
      }
    } finally {
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsBusy(false);
    }
  }

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("accountSecurity.label")}
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        {t("accountSecurity.title")}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("accountSecurity.description")}
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--color-ink)]">
                {t("accountSecurity.verification.title")}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                {t("accountSecurity.verification.description")}
              </p>
            </div>
            <span
              className={`rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                emailVerified
                  ? "bg-white text-[var(--color-primary)]"
                  : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
              }`}
            >
              {t(emailVerified
                ? "accountSecurity.verification.verified"
                : "accountSecurity.verification.required")}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSendVerification}
              disabled={isBusy || emailVerified}
              className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
            >
              {t("accountSecurity.verification.send")}
            </button>
            <button
              type="button"
              onClick={handleRefreshVerification}
              disabled={isBusy}
              className="button-solid px-3.5 py-2 text-xs disabled:opacity-60"
            >
              {t("accountSecurity.verification.refresh")}
            </button>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            {t("accountSecurity.email.title")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountSecurity.email.description").replace(
              "{email}",
              () => user?.email || t("accountSecurity.email.missing"),
            )}
          </p>
          <div className="mt-4 grid gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder={t("accountSecurity.email.placeholder")}
              aria-label={t("accountSecurity.email.label")}
              autoComplete="email"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]"
            />
            <button
              type="button"
              onClick={handleEmailChangeRequest}
              disabled={isBusy || !newEmail.trim()}
              className="button-outline justify-self-start px-3.5 py-2 text-xs disabled:opacity-60"
            >
              {t("accountSecurity.email.send")}
            </button>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            {t("accountSecurity.password.title")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountSecurity.password.description")}
          </p>
          <div className="mt-4 grid gap-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t("accountSecurity.password.current")}
              aria-label={t("accountSecurity.password.current")}
              autoComplete="current-password"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]"
            />
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder={t("accountSecurity.password.next")}
              aria-label={t("accountSecurity.password.next")}
              autoComplete="new-password"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]"
            />
            {nextPassword ? (
              <PasswordStrengthChecklist password={nextPassword} />
            ) : null}
            <TurnstileWidget
              onToken={setCaptchaToken}
              resetSignal={captchaResetSignal}
            />
            <button
              type="button"
              onClick={handlePasswordChangeRequest}
              disabled={
                isBusy || !currentPassword || !passwordReady || captchaPending
              }
              className="button-outline justify-self-start px-3.5 py-2 text-xs disabled:opacity-60"
            >
              {t("accountSecurity.password.update")}
            </button>
            <div className="mt-1 border-t border-[var(--color-line)] pt-3">
              <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                {t("accountSecurity.password.forgot")}
              </p>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={isBusy || captchaPending}
                className="mt-2 text-xs font-bold text-[var(--color-primary)] underline-offset-2 hover:underline disabled:opacity-60"
              >
                {t("accountSecurity.password.sendReset")}
              </button>
            </div>
          </div>
        </div>

        <TotpMfaSection emailVerified={emailVerified} />
      </div>

      {message ? (
        <p ref={revealFeedback} role="status" aria-live="polite" className="mt-4 info-notice">
          {t(message).replace("{email}", () => user?.email ?? "")}
        </p>
      ) : null}

      {error ? (
        <p
          ref={revealFeedback}
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {"key" in error ? t(error.key) : getAuthErrorMessage(error.cause, t)}
        </p>
      ) : null}
    </section>
  );
}

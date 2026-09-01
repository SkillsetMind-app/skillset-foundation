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
  const { user } = useAuth();
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified ?? false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
    setError("");
    setMessage("");

    try {
      await sendSkillsetEmailVerification();
      setMessage("Verification email sent. Check your inbox and return here.");
    } catch {
      setError("Could not send the verification email. Try again in a moment.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshVerification() {
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      const verified = await refreshCurrentUserEmailVerification();
      setEmailVerified(verified);
      setMessage(
        verified
          ? "Email verified. Creator tools can now be enabled."
          : "Email is not verified yet.",
      );
    } catch {
      setError("Could not refresh your email verification status.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEmailChangeRequest() {
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await requestSkillsetEmailChange(newEmail);
      setMessage(
        "Verification sent to the new email. Open it to confirm the email change.",
      );
      setNewEmail("");
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePasswordChangeRequest() {
    if (!passwordReady) {
      setError("Use a password that meets every requirement.");
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await changeSkillsetPassword(
        currentPassword,
        nextPassword,
        captchaToken || undefined,
      );
      setCurrentPassword("");
      setNextPassword("");
      setMessage("Password updated.");
    } catch (caughtError) {
      // Re-authentication for a 2FA user triggers an MFA challenge this form
      // can't resolve. The reset-link path below sets a new password without
      // re-auth, so steer them there instead of showing a code prompt with no
      // field.
      if (isMultiFactorRequiredError(caughtError)) {
        setError(
          'Two-step verification is on for this account. Use "Email me a reset link" below to set a new password without your current one.',
        );
      } else {
        setError(getAuthErrorMessage(caughtError));
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
      setError(
        "This account signs in with Google and has no password to reset. Add an email password from your provider first.",
      );
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      await resetPassword(user.email, captchaToken || undefined);
      setMessage(
        `Reset link sent to ${user.email}. Open it to set a new password — you won't need your current one.`,
      );
    } catch (caughtError) {
      // Same call, same limit, same confusion as the reset page: hitting the
      // send cap means an earlier link already went out, so "Too many
      // attempts" points people at a failure that never happened.
      if (isEmailRateLimitError(caughtError)) {
        setMessage(
          `We already sent a reset link to ${user.email} a moment ago — check your inbox and your spam or promotions folder. You can request another in a few minutes.`,
        );
      } else {
        setError(getAuthErrorMessage(caughtError));
      }
    } finally {
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsBusy(false);
    }
  }

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Security
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        Account protection
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Verify your email before opening creator tools, keep your sign-in
        details current, and add two-factor authentication to protect your
        account.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--color-ink)]">
                Email verification
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                Required for creators before publishing tools are enabled.
              </p>
            </div>
            <span
              className={`rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                emailVerified
                  ? "bg-white text-[var(--color-primary)]"
                  : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
              }`}
            >
              {emailVerified ? "Verified" : "Required"}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSendVerification}
              disabled={isBusy || emailVerified}
              className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
            >
              Send email
            </button>
            <button
              type="button"
              onClick={handleRefreshVerification}
              disabled={isBusy}
              className="button-solid px-3.5 py-2 text-xs disabled:opacity-60"
            >
              Refresh status
            </button>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            Change email
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            Current email: {user?.email || "No email on file"}. We verify the
            new address before replacing it.
          </p>
          <div className="mt-4 grid gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="new-email@example.com"
              aria-label="New email address"
              autoComplete="email"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]"
            />
            <button
              type="button"
              onClick={handleEmailChangeRequest}
              disabled={isBusy || !newEmail.trim()}
              className="button-outline justify-self-start px-3.5 py-2 text-xs disabled:opacity-60"
            >
              Send change confirmation
            </button>
          </div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            Change password
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            Enter your current password before choosing a new one. Social-only
            accounts should use password recovery to add an email password.
          </p>
          <div className="mt-4 grid gap-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              aria-label="Current password"
              autoComplete="current-password"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]"
            />
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder="New password"
              aria-label="New password"
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
              Update password
            </button>
            <div className="mt-1 border-t border-[var(--color-line)] pt-3">
              <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                Forgot your current password? We&apos;ll email a secure reset
                link so you can set a new one without it.
              </p>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={isBusy || captchaPending}
                className="mt-2 text-xs font-bold text-[var(--color-primary)] underline-offset-2 hover:underline disabled:opacity-60"
              >
                Email me a reset link
              </button>
            </div>
          </div>
        </div>

        <TotpMfaSection emailVerified={emailVerified} />
      </div>

      {message ? (
        <p ref={revealFeedback} role="status" aria-live="polite" className="mt-4 info-notice">
          {message}
        </p>
      ) : null}

      {error ? (
        <p
          ref={revealFeedback}
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

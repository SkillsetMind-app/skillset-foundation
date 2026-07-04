"use client";

import { useState, type FormEvent } from "react";

import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { getAuthErrorMessage, resetPassword } from "@/lib/auth/supabase-auth";

export function ResetPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Turnstile token — empty unless the widget is enabled.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsLoading(true);

    try {
      await resetPassword(email, captchaToken || undefined);
      setSuccess(
        "If an account exists for this email, we've sent a reset link. It can take a minute to arrive — check your inbox and your spam or promotions folder. If you signed up with Google, use 'Continue with Google' to sign in instead.",
      );
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      // Single-use token: refresh for the next attempt either way.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleReset}>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
        />
      </label>
      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-[10px] border border-[rgba(26,54,93,0.14)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]"
        >
          {success}
        </p>
      ) : null}
      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
      <button
        type="submit"
        disabled={isLoading || (isCaptchaEnabled && !captchaToken)}
        className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {isLoading ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}

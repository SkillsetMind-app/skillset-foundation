"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  completePasswordRecovery,
  getAuthErrorMessage,
} from "@/lib/auth/supabase-auth";

/**
 * Second half of the forgot-password flow. The reset email lands on
 * /auth/callback, which exchanges the recovery code for a session, sets the
 * recovery cookie and forwards here. A session alone is NOT proof of a valid
 * reset link — any signed-in user has one — so the form also requires
 * `recoveryVerified` (the server-read recovery cookie) before offering a
 * password change that skips the current-password check.
 */
export function UpdatePasswordForm({
  recoveryVerified,
}: {
  recoveryVerified: boolean;
}) {
  const { status } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!passwordReady) {
      setError("Use a password that meets every requirement.");
      return;
    }

    if (!passwordsMatch) {
      setError("The passwords don't match.");
      return;
    }

    setIsLoading(true);

    try {
      await completePasswordRecovery(password);
      setIsDone(true);
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  // No recovery cookie (a regular signed-in session navigated here directly)
  // or no session at all (link expired, already used, or invalid) — either
  // way, refuse the no-current-password form.
  if (!recoveryVerified || status === "unauthenticated") {
    return (
      <div className="mt-6 grid gap-4">
        <p
          role="alert"
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          This password reset link is invalid or has expired. Reset links can
          only be used once.
        </p>
        <Link
          href="/forgot-password"
          className="button-solid justify-self-start px-4 py-2.5 text-sm"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <p
        className="mt-6 text-sm leading-6 text-[var(--color-ink-soft)]"
        aria-busy="true"
      >
        Checking your reset link...
      </p>
    );
  }

  if (isDone) {
    return (
      <div className="mt-6 grid gap-4">
        <p
          role="status"
          aria-live="polite"
          className="rounded-[10px] border border-[rgba(26,54,93,0.14)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]"
        >
          Your password has been updated. You&apos;re signed in and can use it
          next time.
        </p>
        <Link
          href="/account"
          className="button-solid justify-self-start px-4 py-2.5 text-sm"
        >
          Continue to your account
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        New password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter a new password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          className="field-input"
        />
        {password ? <PasswordStrengthChecklist password={password} /> : null}
      </label>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        Confirm new password
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Repeat the new password"
          autoComplete="new-password"
          required
          aria-invalid={showMismatch}
          className="field-input"
        />
        {showMismatch ? (
          <span className="text-xs font-semibold text-[var(--color-accent-fg)]">
            The passwords don&apos;t match.
          </span>
        ) : null}
      </label>
      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isLoading || !passwordReady || !passwordsMatch}
        className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {isLoading ? "Updating password..." : "Update password"}
      </button>
    </form>
  );
}

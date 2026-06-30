"use client";

import type { MultiFactorError } from "firebase/auth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import {
  completeMfaSignIn,
  getAuthErrorMessage,
  isMultiFactorRequiredError,
  signInWithEmail,
  signInWithGoogle,
} from "@/lib/auth/firebase-auth";
import {
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
  getSafeReturnTo,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // Deep link the sign-in wall captured (e.g. /learn/courses/x). Honored only
  // for onboarded accounts — first-time users still go through /welcome.
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);
  const pathLabel = pathIntent === "teacher" ? "educator" : "learner";
  const signupHref = pathIntent
    ? `/auth?mode=signup&path=${pathIntent}`
    : "/auth?mode=signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Set when a sign-in succeeds at the password step but the account also
  // requires a TOTP second factor. Holds the original error the resolver needs.
  const [mfaError, setMfaError] = useState<MultiFactorError | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  async function finishLogin(uid: string) {
    const profile = await getUserProfile(uid);
    router.push(
      profile?.onboardingCompleted
        ? returnTo ?? getLoadingRoute("route", pathIntent)
        : getLoadingRoute("welcome", pathIntent),
    );
  }

  async function handleEmailLogin() {
    setError("");
    setIsLoading(true);

    try {
      const user = await signInWithEmail({ email, password });
      await finishLogin(user.uid);
    } catch (caughtError) {
      if (isMultiFactorRequiredError(caughtError)) {
        setMfaError(caughtError);
        setMfaCode("");
        setError("");
      } else {
        setError(getAuthErrorMessage(caughtError));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setIsLoading(true);

    try {
      const user = await signInWithGoogle();
      await finishLogin(user.uid);
    } catch (caughtError) {
      if (isMultiFactorRequiredError(caughtError)) {
        setMfaError(caughtError);
        setMfaCode("");
        setError("");
      } else {
        setError(getAuthErrorMessage(caughtError));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMfaSubmit() {
    if (!mfaError || mfaCode.length < 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const user = await completeMfaSignIn(mfaError, mfaCode);
      await finishLogin(user.uid);
    } catch (caughtError) {
      // Stay on the challenge so a mistyped code can be retried.
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mfaError) {
      void handleMfaSubmit();
    } else {
      void handleEmailLogin();
    }
  }

  // Second-factor challenge: shown after the password verifies but the account
  // has TOTP enrolled. Resolving here is what keeps 2FA from locking anyone out.
  if (mfaError) {
    return (
      <form className="mt-5 grid gap-3.5" onSubmit={handleSubmit}>
        <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Two-step verification
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            Enter the 6-digit code from your authenticator app to finish signing
            in.
          </p>
        </div>
        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Authentication code
          <input
            value={mfaCode}
            onChange={(event) =>
              setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            className="field-input text-center font-mono text-lg tracking-[0.4em]"
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
        <button
          type="submit"
          disabled={isLoading || mfaCode.length < 6}
          className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isLoading ? "Verifying..." : "Verify and sign in"}
        </button>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            setMfaError(null);
            setMfaCode("");
            setError("");
          }}
          className="text-sm font-semibold text-[var(--color-primary)] disabled:opacity-60"
        >
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form className="mt-5 grid gap-3.5" onSubmit={handleSubmit}>
      <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {pathLabel} access
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          Sign in and Skillset opens the workspace that matches your account.
        </p>
      </div>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          className="field-input"
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
          required
          className="field-input"
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
      <button type="submit" disabled={isLoading} className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60">
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
      <button
        type="button"
        disabled={isLoading}
        onClick={handleGoogleLogin}
        className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
      >
        <GoogleMark />
        Continue with Google
      </button>
      <Link
        href="/forgot-password"
        className="inline-flex text-sm font-semibold text-[var(--color-primary)]"
      >
        Forgot password?
      </Link>
      <Link
        href={signupHref}
        className="inline-flex text-sm font-semibold text-[var(--color-primary)]"
      >
        New to Skillset? Create an account
      </Link>
    </form>
  );
}

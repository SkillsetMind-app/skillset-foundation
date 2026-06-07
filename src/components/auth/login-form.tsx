"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import {
  getAuthErrorMessage,
  signInWithEmail,
  signInWithGoogle,
} from "@/lib/auth/firebase-auth";
import {
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  const pathLabel = pathIntent === "teacher" ? "educator" : "learner";
  const signupHref = pathIntent
    ? `/auth?mode=signup&path=${pathIntent}`
    : "/auth?mode=signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const user = await signInWithEmail({ email, password });
      const profile = await getUserProfile(user.uid);
      router.push(
        profile?.onboardingCompleted
          ? getLoadingRoute("route", pathIntent)
          : getLoadingRoute("welcome", pathIntent),
      );
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setIsLoading(true);

    try {
      const user = await signInWithGoogle();
      const profile = await getUserProfile(user.uid);
      router.push(
        profile?.onboardingCompleted
          ? getLoadingRoute("route", pathIntent)
          : getLoadingRoute("welcome", pathIntent),
      );
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-5 grid gap-3.5" onSubmit={handleEmailLogin}>
      <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          {pathLabel} access
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          Sign in and Skillset will send you to the right workspace for this path.
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
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent)]"
        >
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={isLoading} className="button-solid mt-2 px-5 py-3 text-sm disabled:opacity-60">
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
      <button
        type="button"
        disabled={isLoading}
        onClick={handleGoogleLogin}
        className="button-outline px-5 py-3 text-sm disabled:opacity-60"
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
        Need an account for this path?
      </Link>
    </form>
  );
}

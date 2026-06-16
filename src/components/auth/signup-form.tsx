"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  getAuthErrorMessage,
  signInWithGoogle,
  signUpWithEmail,
} from "@/lib/auth/firebase-auth";
import {
  normalizeUsername,
  validateDisplayName,
} from "@/lib/auth/profile-validation";
import {
  getAuthPathIntentFromSearchParams,
  getAuthPathQuery,
  getLoadingRoute,
} from "@/lib/auth/routing";
import {
  acceptUserTerms,
  getUserProfile,
  updateUserIdentity,
} from "@/lib/data/user-profiles";
import { track } from "@/lib/posthog/events";

// Username is no longer asked at signup (it lived in a heavy field that made
// the form scroll). We derive a valid handle from the name/email so the
// existing profile contract stays intact; the member can change it later
// from their profile.
function deriveUsername(displayName: string, email: string): string {
  const fromName = normalizeUsername(displayName);
  if (fromName.length >= 3) {
    return fromName.slice(0, 32);
  }

  const fromEmail = normalizeUsername(email.split("@")[0] ?? "");
  if (fromEmail.length >= 3) {
    return fromEmail.slice(0, 32);
  }

  return `member-${Math.random().toString(36).slice(2, 8)}`;
}

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  const pathLabel = pathIntent === "teacher" ? "educator" : "learner";
  const signinHref = pathIntent
    ? `/auth?mode=signin&path=${pathIntent}`
    : "/auth?mode=signin";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;

  async function handleEmailSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!legalAccepted) {
      setError("Accept the Terms of Service and Privacy Policy to create your account.");
      return;
    }

    const displayNameError = validateDisplayName(displayName);

    if (displayNameError) {
      setError(displayNameError);
      return;
    }

    if (!passwordReady) {
      setError("Use a password that meets every requirement.");
      return;
    }

    if (!passwordsMatch) {
      setError("The two passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const user = await signUpWithEmail({ displayName, email, password });
      await acceptUserTerms(user.uid, false);
      await updateUserIdentity(user.uid, {
        displayName,
        username: deriveUsername(displayName, email),
      });
      track.userSignedUp({
        role: pathIntent === "teacher" ? "teacher" : "student",
        source: "email",
      });
      router.push(`/welcome${getAuthPathQuery(pathIntent)}`);
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setError("");

    if (!legalAccepted) {
      setError("Accept the Terms of Service and Privacy Policy before continuing with Google.");
      return;
    }

    setIsLoading(true);

    try {
      const user = await signInWithGoogle();
      await acceptUserTerms(user.uid, false);
      const profile = await getUserProfile(user.uid);
      // Only track as signup if this is the user's first hit (no completed
      // onboarding yet). Returning users hitting Google sign-in fall under
      // identifyUser via AuthProvider instead.
      if (!profile?.onboardingCompleted) {
        track.userSignedUp({
          role: pathIntent === "teacher" ? "teacher" : "student",
          source: "google",
        });
      }
      router.push(
        profile?.onboardingCompleted
          ? getLoadingRoute("route", pathIntent)
          : `/welcome${getAuthPathQuery(pathIntent)}`,
      );
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-5 grid gap-3" onSubmit={handleEmailSignup}>
      <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
        Continues into the {pathLabel} setup — you can add the other side later
        from your profile.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
          Full name
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            autoComplete="name"
            required
            className="field-input"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
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
      </div>

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          className="field-input"
        />
        {password ? <PasswordStrengthChecklist password={password} /> : null}
      </label>

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        Confirm password
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          required
          aria-invalid={showMismatch}
          className="field-input"
        />
        {showMismatch ? (
          <span className="text-xs font-semibold text-[var(--color-accent-fg)]">
            The two passwords do not match.
          </span>
        ) : null}
      </label>

      <label className="flex items-start gap-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
        <input
          type="checkbox"
          checked={legalAccepted}
          onChange={(event) => setLegalAccepted(event.target.checked)}
          className="mt-1"
          required
        />
        <span>
          I agree to the Skillset{" "}
          <Link href="/legal/terms" className="font-semibold text-[var(--color-primary)]">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="font-semibold text-[var(--color-primary)]">
            Privacy Policy
          </Link>
          .
        </span>
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
        disabled={
          isLoading || !legalAccepted || !passwordReady || !passwordsMatch
        }
        className="button-solid mt-1 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {isLoading ? "Creating account..." : "Create account"}
      </button>

      <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        or
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>

      <button
        type="button"
        disabled={isLoading || !legalAccepted}
        onClick={handleGoogleSignup}
        className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
      >
        <GoogleMark />
        Continue with Google
      </button>
      <Link
        href={signinHref}
        className="mt-1 inline-flex text-sm font-semibold text-[var(--color-primary)]"
      >
        Already have an account?
      </Link>
    </form>
  );
}

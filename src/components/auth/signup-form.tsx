"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  getAuthErrorMessage,
  isMultiFactorRequiredError,
  signInWithGoogle,
  signUpWithEmail,
} from "@/lib/auth/supabase-auth";
import {
  formatValidationMessage,
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
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // Visible learn/teach choice on the form itself. URL ?path (marketing CTAs)
  // seeds it; toggling re-writes the URL so the aside panel — keyed by ?path —
  // and any refresh stay in sync with the pick.
  const [intent, setIntent] = useState<"student" | "teacher">(
    pathIntent ?? "student",
  );

  function chooseIntent(next: "student" | "teacher") {
    setIntent(next);
    router.replace(
      next === "teacher" ? "/auth?mode=signup&path=teacher" : "/auth?mode=signup&path=student",
      { scroll: false },
    );
  }

  const intro = t(
    intent === "teacher"
      ? "auth.signup.introEducator"
      : "auth.signup.introLearner",
  );
  const signinHref = `/auth?mode=signin&path=${intent}`;
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
      setError(t("auth.signup.acceptTermsToCreate"));
      return;
    }

    const displayNameError = validateDisplayName(displayName);

    if (displayNameError) {
      setError(formatValidationMessage(displayNameError, t));
      return;
    }

    if (!passwordReady) {
      setError(t("auth.signup.passwordRequirements"));
      return;
    }

    if (!passwordsMatch) {
      setError(t("auth.signup.passwordsDontMatch"));
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
        role: intent === "teacher" ? "teacher" : "student",
        source: "email",
      });
      router.push(`/welcome${getAuthPathQuery(intent)}`);
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setError("");

    if (!legalAccepted) {
      setError(t("auth.signup.acceptTermsForGoogle"));
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
          role: intent === "teacher" ? "teacher" : "student",
          source: "google",
        });
      }
      router.push(
        profile?.onboardingCompleted
          ? getLoadingRoute("route", intent)
          : `/welcome${getAuthPathQuery(intent)}`,
      );
    } catch (caughtError) {
      // A returning user with TOTP enrolled trips an MFA challenge here, but
      // the signup surface has no resolver — steer them to sign-in, which does.
      if (isMultiFactorRequiredError(caughtError)) {
        setError(t("auth.signup.mfaUseSignIn"));
      } else {
        setError(getAuthErrorMessage(caughtError));
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-5 grid gap-3" onSubmit={handleEmailSignup}>
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-semibold text-[var(--color-ink)]">
          {t("auth.signup.roleQuestion")}
        </legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(["student", "teacher"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={intent === option}
              onClick={() => chooseIntent(option)}
              className={[
                "rounded-[10px] border-[1.5px] px-4 py-2.5 text-sm font-semibold transition",
                intent === option
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-base)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
              ].join(" ")}
            >
              {t(option === "student" ? "auth.signup.roleLearn" : "auth.signup.roleTeach")}
            </button>
          ))}
        </div>
      </fieldset>

      <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{intro}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
          {t("auth.signup.fullName")}
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t("auth.signup.fullNamePlaceholder")}
            autoComplete="name"
            required
            className="field-input"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
          {t("auth.email")}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            autoComplete="email"
            required
            className="field-input"
          />
        </label>
      </div>

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        {t("auth.password")}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("auth.signup.passwordPlaceholder")}
          autoComplete="new-password"
          minLength={8}
          required
          className="field-input"
        />
        {password ? <PasswordStrengthChecklist password={password} /> : null}
      </label>

      <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
        {t("auth.signup.confirmPassword")}
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder={t("auth.signup.confirmPasswordPlaceholder")}
          autoComplete="new-password"
          required
          aria-invalid={showMismatch}
          className="field-input"
        />
        {showMismatch ? (
          <span className="text-xs font-semibold text-[var(--color-accent-fg)]">
            {t("auth.signup.passwordsDontMatch")}
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
          {t("auth.signup.agreePrefix")}
          <Link href="/legal/terms" className="font-semibold text-[var(--color-primary)]">
            {t("footer.termsOfService")}
          </Link>
          {t("auth.signup.agreeMiddle")}
          <Link href="/legal/privacy" className="font-semibold text-[var(--color-primary)]">
            {t("footer.privacyPolicy")}
          </Link>
          {t("auth.signup.agreeSuffix")}
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
        {isLoading
          ? t("auth.signup.creatingAccount")
          : t("auth.signup.createAccount")}
      </button>

      <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        {t("auth.signup.or")}
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>

      {isGoogleAuthEnabled ? (
        <button
          type="button"
          disabled={isLoading || !legalAccepted}
          onClick={handleGoogleSignup}
          className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
        >
          <GoogleMark />
          {t("auth.continueWithGoogle")}
        </button>
      ) : null}
      <Link
        href={signinHref}
        className="mt-1 inline-flex text-sm font-semibold text-[var(--color-primary)]"
      >
        {t("auth.signup.alreadyHaveAccount")}
      </Link>
    </form>
  );
}

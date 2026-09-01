"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  getAuthErrorMessage,
  isAccountExistsError,
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
  // The email already has an account. The way forward is sign-in, so the
  // error grows a link there instead of leaving a "Create account" button that
  // can only fail the same way again.
  const [accountExists, setAccountExists] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Turnstile token — empty unless the widget is enabled. Shown on step 2 where
  // the account is actually created (Google OAuth doesn't use a captcha token).
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  // Two-step wizard: step 1 = identity (role/name/email/terms), step 2 = the
  // password. Splitting keeps each screen within one viewport (no scroll), the
  // market-standard signup shape. The rest of the profile is collected later at
  // /welcome onboarding.
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmSent, setConfirmSent] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;

  async function handleEmailSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAccountExists(false);

    if (!legalAccepted) {
      setError(t("auth.signup.acceptTermsToCreate"));
      return;
    }

    const displayNameError = validateDisplayName(displayName);

    if (displayNameError) {
      setError(formatValidationMessage(displayNameError, t));
      return;
    }

    // Step 1 only validates identity + terms, then advances. The password lives
    // on step 2, so the account isn't created until the second submit.
    if (step === 1) {
      setStep(2);
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
      const { user, needsEmailConfirmation } = await signUpWithEmail(
        { displayName, email, password },
        captchaToken || undefined,
      );
      track.userSignedUp({
        role: intent === "teacher" ? "teacher" : "student",
        source: "email",
      });

      // No session yet: every profile write below would be filtered by RLS and
      // return a silent zero-row success, and /welcome would bounce straight to
      // sign-in with no explanation. Park on the confirm screen instead — terms
      // are re-captured by the acceptance modal and the username by onboarding,
      // both of which run once the confirmed session exists.
      if (needsEmailConfirmation) {
        setConfirmSent(true);
        return;
      }

      // The account exists from here on, so these two writes are best-effort.
      // When one fails the member still has to reach /welcome: the same
      // recovery the confirmation path already relies on picks up what is
      // missing — the legal gate re-asks for the terms on the first page after
      // onboarding, and the username stays optional until they pick one in
      // their profile. Reporting the failure as a signup error left the
      // account orphaned behind a form whose only next answer was "already
      // exists".
      try {
        await acceptUserTerms(user.uid, false);
        await updateUserIdentity(user.uid, {
          displayName,
          username: deriveUsername(displayName, email),
        });
      } catch (profileError) {
        console.error("Post-signup profile writes failed", profileError);
      }
      router.push(`/welcome${getAuthPathQuery(intent)}`);
    } catch (caughtError) {
      // Single-use Turnstile token — refresh for the retry.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setAccountExists(isAccountExistsError(caughtError));
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
      // Through /loading, so a brand-new Google account reaches onboarding
      // instead of the home page; the legal gate re-collects the terms after.
      const user = await signInWithGoogle(getLoadingRoute("welcome", intent));
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

  const errorNode = error ? (
    <p
      role="alert"
      aria-live="assertive"
      className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
    >
      {error}
      {accountExists ? (
        <>
          {" "}
          <Link href={signinHref} className="underline underline-offset-4">
            {t("auth.signup.existingAccountSignIn")}
          </Link>
        </>
      ) : null}
    </p>
  ) : null;

  // Account created, session pending confirmation. The form is done — replacing
  // it (rather than routing to /welcome) keeps the user on a screen that
  // explains the next step instead of an unexplained sign-in page.
  if (confirmSent) {
    return (
      <section
        className="mt-5 grid gap-3 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-6"
        aria-live="polite"
      >
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("auth.signup.confirmTitle")}
        </h2>
        <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("auth.signup.confirmSentTo")}{" "}
          <strong className="font-semibold text-[var(--color-ink)]">{email}</strong>.{" "}
          {t("auth.signup.confirmBody")}
        </p>
        <Link
          href="/auth?mode=signin"
          className="justify-self-start rounded-[10px] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-base)]"
        >
          {t("auth.signup.confirmSignIn")}
        </Link>
      </section>
    );
  }

  return (
    <form className="mt-5 grid gap-3" onSubmit={handleEmailSignup}>
      {/* Progress dots — the active step widens. Signals "there's a next screen"
          so the short step 1 doesn't read as the whole signup. */}
      <div className="flex items-center justify-center gap-2" aria-hidden="true">
        {[1, 2].map((n) => (
          <span
            key={n}
            className={[
              "h-1.5 rounded-full transition-all",
              step === n ? "w-6 bg-[var(--color-primary)]" : "w-2 bg-[var(--color-line)]",
            ].join(" ")}
          />
        ))}
      </div>

      {step === 1 ? (
        <>
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

          <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={legalAccepted}
              onChange={(event) => setLegalAccepted(event.target.checked)}
              className="mt-0.5"
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

          {errorNode}

          <button
            type="submit"
            disabled={isLoading || !legalAccepted}
            className="button-solid mt-1 px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t("auth.signup.continue")}
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
        </>
      ) : (
        <>
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
              autoFocus
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

          {errorNode}

          <TurnstileWidget
            onToken={setCaptchaToken}
            resetSignal={captchaResetSignal}
          />

          <button
            type="submit"
            disabled={
              isLoading ||
              !legalAccepted ||
              !passwordReady ||
              !passwordsMatch ||
              (isCaptchaEnabled && !captchaToken)
            }
            className="button-solid mt-1 px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isLoading
              ? t("auth.signup.creatingAccount")
              : t("auth.signup.createAccount")}
          </button>

          <button
            type="button"
            onClick={() => {
              setError("");
              setStep(1);
            }}
            className="mt-1 inline-flex items-center justify-center text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.signup.back")}
          </button>
        </>
      )}
    </form>
  );
}

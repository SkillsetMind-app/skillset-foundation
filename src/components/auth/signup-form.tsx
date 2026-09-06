"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { ConfirmEmailGate } from "@/components/auth/confirm-email-gate";
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
  deriveUsername,
  formatValidationMessage,
  validateDisplayName,
} from "@/lib/auth/profile-validation";
import {
  getAuthRoute,
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
  getSafeReturnTo,
  getWelcomeRoute,
} from "@/lib/auth/routing";
import {
  acceptUserTerms,
  getUserProfile,
  updateUserIdentity,
} from "@/lib/data/user-profiles";
import { track } from "@/lib/posthog/events";

// Username is no longer asked at signup (it lived in a heavy field that made
// the form scroll). deriveUsername shapes a valid handle from the name/e-mail,
// or null — it is optional — and the member can change it from their profile.

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
  // Where the visitor was headed when the wall stopped them — the course they
  // pressed "enroll" on. Sign-in already honoured it; signup dropped it, so the
  // buyer landed on a dashboard and the sale evaporated. Validated (same-origin
  // path only) before it is carried anywhere.
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);

  function chooseIntent(next: "student" | "teacher") {
    setIntent(next);
    const params = new URLSearchParams({ mode: "signup", path: next });
    // Toggling learn/teach rewrites the URL — without this the destination was
    // erased by a click that has nothing to do with it.
    if (returnTo) params.set("returnTo", returnTo);
    router.replace(`/auth?${params.toString()}`, { scroll: false });
  }

  const intro = t(
    intent === "teacher"
      ? "auth.signup.introEducator"
      : "auth.signup.introLearner",
  );
  const signinHref = getAuthRoute("signin", intent, returnTo);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [error, setError] = useState<{ key: string } | { cause: unknown } | null>(null);
  const errorMessage = error
    ? "key" in error ? formatValidationMessage(error.key, t) : getAuthErrorMessage(error.cause, t)
    : "";
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
  // O olhinho, um por campo: quem cria senha quer conferir o que digitou nos
  // DOIS campos — o login ja tinha o seu; o cadastro, onde ele mais importa,
  // nao tinha.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;

  async function handleEmailSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAccountExists(false);

    if (!legalAccepted) {
      setError({ key: "auth.signup.acceptTermsToCreate" });
      return;
    }

    const displayNameError = validateDisplayName(displayName);

    if (displayNameError) {
      setError({ key: displayNameError });
      return;
    }

    // Step 1 only validates identity + terms, then advances. The password lives
    // on step 2, so the account isn't created until the second submit.
    if (step === 1) {
      setStep(2);
      return;
    }

    if (!passwordReady) {
      setError({ key: "auth.signup.passwordRequirements" });
      return;
    }

    if (!passwordsMatch) {
      setError({ key: "auth.signup.passwordsDontMatch" });
      return;
    }

    setIsLoading(true);

    try {
      const { user, needsEmailConfirmation } = await signUpWithEmail(
        { displayName, email, password },
        captchaToken || undefined,
        // The confirmation link carries the destination itself, so it survives
        // being opened on a phone where this tab does not exist.
        getWelcomeRoute(intent, returnTo),
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
      router.push(getWelcomeRoute(intent, returnTo));
    } catch (caughtError) {
      // Single-use Turnstile token — refresh for the retry.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setAccountExists(isAccountExistsError(caughtError));
      setError({ cause: caughtError });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setError(null);

    if (!legalAccepted) {
      setError({ key: "auth.signup.acceptTermsForGoogle" });
      return;
    }

    setIsLoading(true);

    try {
      // Through /loading, so a brand-new Google account reaches onboarding
      // instead of the home page; the legal gate re-collects the terms after.
      const user = await signInWithGoogle(
        getLoadingRoute("welcome", intent, returnTo),
      );
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
          ? returnTo ?? getLoadingRoute("route", intent)
          : getWelcomeRoute(intent, returnTo),
      );
    } catch (caughtError) {
      // A returning user with TOTP enrolled trips an MFA challenge here, but
      // the signup surface has no resolver — steer them to sign-in, which does.
      if (isMultiFactorRequiredError(caughtError)) {
        setError({ key: "auth.signup.mfaUseSignIn" });
      } else {
        setError({ cause: caughtError });
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
      {errorMessage}
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
  // explains the next step instead of an unexplained sign-in page. A porta
  // tem "reenviar" e "trocar o e-mail": antes era um beco sem saida.
  if (confirmSent) {
    return (
      <ConfirmEmailGate
        email={email}
        intent={intent}
        returnTo={returnTo}
        onChangeEmail={() => {
          setConfirmSent(false);
          setStep(1);
        }}
      />
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
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.signup.passwordPlaceholder")}
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
                className="field-input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </span>
            {password ? <PasswordStrengthChecklist password={password} /> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            {t("auth.signup.confirmPassword")}
            <span className="relative block">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={t("auth.signup.confirmPasswordPlaceholder")}
                autoComplete="new-password"
                required
                aria-invalid={showMismatch}
                className="field-input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                aria-label={t(
                  showConfirmPassword ? "auth.hidePassword" : "auth.showPassword",
                )}
                aria-pressed={showConfirmPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </span>
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
              setError(null);
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

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { ConfirmEmailGate } from "@/components/auth/confirm-email-gate";
import { GoogleMark } from "@/components/auth/google-mark";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
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
  getEntryReturnTo,
  getLoadingRoute,
  getOnboardedReturnTo,
  getWelcomeRoute,
} from "@/lib/auth/routing";
import { markSignupTerms } from "@/lib/auth/signup-terms-mark";
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
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // Visible learn/teach choice on the form itself. URL ?path (marketing CTAs)
  // seeds it; toggling re-writes the URL so any refresh stays in sync.
  const [intent, setIntent] = useState<"student" | "teacher">(
    pathIntent ?? "student",
  );
  // Where the visitor was headed when the wall stopped them — the course they
  // pressed "enroll" on. Sign-in already honoured it; signup dropped it, so the
  // buyer landed on a dashboard and the sale evaporated. Validated (same-origin
  // path only) before it is carried anywhere. A /pricing button arrives the
  // same way: its plan and cycle become the card screen as the destination.
  const returnTo = useMemo(() => getEntryReturnTo(searchParams), [searchParams]);

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
  ).replace("{days}", String(PLAN_TRIAL_DAYS));
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
  // Which button was pressed, only for the label (isLoading still locks both).
  // "Back" in the middle of creating the account showed Google saying
  // "Opening Google..." when nobody had clicked it.
  const [pendingMethod, setPendingMethod] = useState<"email" | "google" | null>(null);
  // Turnstile token — empty unless the widget is enabled. Shown on step 2 where
  // the account is actually created (Google OAuth doesn't use a captcha token).
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  // Two-step wizard: step 1 = identity (role/name/email/terms), step 2 = the
  // password. Splitting keeps each screen within one viewport (no scroll), the
  // market-standard signup shape. The rest of the profile is collected later at
  // /welcome onboarding.
  const [step, setStep] = useState<1 | 2>(1);
  const [focusIdentityOnReturn, setFocusIdentityOnReturn] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  // The eye icon, one per field: someone creating a password wants to check
  // what they typed in BOTH fields. Login already had its own; sign-up, where
  // it matters most, did not.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;
  // Why "Create account" is dimmed (the lock is the same; it just gets
  // stated now). Mismatched passwords already have their own sentence under the
  // confirmation: the button points to it. The security check shows its own state.
  const createBlockedReason = !legalAccepted
    ? t("auth.signup.acceptTermsToCreate")
    : !passwordReady
      ? t("auth.signup.choosePasswordFirst")
      : !passwordsMatch && !showMismatch
        ? t("auth.signup.confirmPasswordFirst")
        : "";
  const createDescribedBy = createBlockedReason
    ? "signup-create-blocked"
    : showMismatch
      ? "signup-password-mismatch"
      : undefined;
  const stepLabel = t("auth.signup.progress")
    .replace("{current}", String(step))
    .replace("{total}", "2");

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

    setPendingMethod("email");
    setIsLoading(true);

    try {
      const { user, needsEmailConfirmation } = await signUpWithEmail(
        // legalAccepted is required above: the checkmark goes along with the account.
        { displayName, email, password, locale, acceptedTerms: true },
        captchaToken || undefined,
        // The confirmation link carries the destination itself, so it survives
        // being opened on a phone where this tab does not exist.
        getWelcomeRoute(intent, returnTo),
      );
      track.userSignedUp({
        role: intent === "teacher" ? "teacher" : "student",
        source: "email",
      });

      // Still no session: every profile write below would be filtered by RLS
      // (silent success with zero rows) and /welcome would send them straight to
      // login with no explanation. They stay on the confirm screen. The terms checked here
      // go into the account metadata, and the terms gate records them on the first
      // signed-in page (without asking again) if it opens in this browser; the
      // @ handle is left for onboarding.
      if (needsEmailConfirmation) {
        markSignupTerms(user.uid);
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

    setPendingMethod("google");
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
          ? getOnboardedReturnTo(profile, returnTo, intent) ?? getLoadingRoute("route", intent)
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

  const introNode = (
    <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
      {intro}
      {intent === "teacher" ? (
        <>
          {" "}
          <Link
            href="/pricing"
            className="font-semibold text-[var(--color-primary)]! underline underline-offset-4"
          >
            {t("auth.signup.plansLink")}
          </Link>
        </>
      ) : null}
    </p>
  );

  const errorNode = error ? (
    // Only the box changed (the app's own notice, with an icon): text, link and announcement
    // (role="alert", aria-live="assertive") are the same as before.
    <InlineAlert tone="error">
      {errorMessage}
      {accountExists ? (
        <>
          {" "}
          <Link href={signinHref} className="underline underline-offset-4">
            {t("auth.signup.existingAccountSignIn")}
          </Link>
        </>
      ) : null}
    </InlineAlert>
  ) : null;

  // Account created, session pending confirmation. The form is done — replacing
  // it (rather than routing to /welcome) keeps the user on a screen that
  // explains the next step instead of an unexplained sign-in page. A porta
  // has "resend" and "change the email": before, it was a dead end.
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
      {/* The hand-made dots became the app's own progress bar (the one in the classroom and the
          builder). The visible text is hidden from screen readers: the bar already says
          "Step 1 of 2", with the step from 1 to 2, as before. */}
      <div className="flex items-center gap-3 text-xs font-semibold text-[var(--color-ink-soft)]">
        <span aria-hidden="true">{stepLabel}</span>
        <ProgressBar value={step * 50} step={{ current: step, total: 2 }} label={stepLabel} className="w-16" />
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
                    "min-h-11 rounded-md border-[1.5px] px-4 py-2.5 text-sm font-semibold transition",
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

          {introNode}

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
              {t("auth.signup.fullName")}
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("auth.signup.fullNamePlaceholder")}
                autoComplete="name"
                autoFocus={focusIdentityOnReturn}
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

          {/* Accepting is what unlocks sign-up: body text, not footer text. */}
          <label className="flex items-start gap-2.5 text-sm leading-6 text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={legalAccepted}
              onChange={(event) => setLegalAccepted(event.target.checked)}
              // The browser's bubble comes in the browser's language and disappears on its own:
              // the page's notice stays, in the page's language.
              onInvalid={() => setError({ key: "auth.signup.acceptTermsToCreate" })}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]"
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

          {/* Without accepting, the button stays clickable: when dimmed, it did not say
              why. The click now points to the checkbox (required) or shows the notice
              that handleEmailSignup/handleGoogleSignup already had. */}
          <button
            key="identity-continue"
            type="submit"
            disabled={isLoading}
            className="button-solid mt-1 px-4 py-2.5 text-sm"
          >
            {t("auth.signup.continue")}
          </button>

          {isGoogleAuthEnabled ? (
            <>
              <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                <span className="h-px flex-1 bg-[var(--color-line)]" />
                {t("auth.signup.or")}
                <span className="h-px flex-1 bg-[var(--color-line)]" />
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleGoogleSignup}
                className="button-outline px-4 py-2.5 text-sm"
              >
                <GoogleMark />
                {isLoading && pendingMethod === "google"
                  ? t("auth.openingGoogle")
                  : t("auth.continueWithGoogle")}
              </button>
            </>
          ) : null}
          <Link
            href={signinHref}
            className="auth-text-link mt-1 text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.signup.alreadyHaveAccount")}
          </Link>
        </>
      ) : (
        <>
          {intent === "teacher" ? introNode : null}
          {/* Label and field side by side (htmlFor), with the eye outside the
              <label>: inside it, the button's name became part of the field's name. */}
          <div className="grid gap-1.5">
            <label htmlFor="signup-password" className="text-sm font-semibold text-[var(--color-ink)]">
              {t("auth.password")}
            </label>
            <span className="relative block">
              <input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.signup.passwordPlaceholder")}
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
                aria-describedby="signup-password-rules"
                className="field-input pr-11"
              />
              <PasswordVisibilityToggle
                visible={showPassword}
                onToggle={() => setShowPassword((visible) => !visible)}
              />
            </span>
          </div>
          {/* The rules show from the start (the missing ones dimmed): before, they
              appeared at the 1st character and pushed the rest of the form down. Outside
              the <label>, so the field's name stays just "Password";
              the field points to them as its description. */}
          <div id="signup-password-rules">
            <PasswordStrengthChecklist password={password} />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="signup-confirm-password" className="text-sm font-semibold text-[var(--color-ink)]">
              {t("auth.signup.confirmPassword")}
            </label>
            <span className="relative block">
              <input
                id="signup-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={t("auth.signup.confirmPasswordPlaceholder")}
                autoComplete="new-password"
                required
                aria-invalid={showMismatch}
                aria-describedby={showMismatch ? "signup-password-mismatch" : undefined}
                className="field-input pr-11"
              />
              <PasswordVisibilityToggle
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((visible) => !visible)}
              />
            </span>
          </div>
          {/* Outside the <label>: inside it the sentence became part of the field's name.
              The field points to it as its description while it is shown. */}
          {showMismatch ? (
            <span
              id="signup-password-mismatch"
              className="-mt-1 text-xs font-semibold text-[var(--color-danger-fg)]"
            >
              {t("auth.signup.passwordsDontMatch")}
            </span>
          ) : null}

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
            aria-describedby={createDescribedBy}
            className="button-solid mt-1 px-4 py-2.5 text-sm"
          >
            {isLoading
              ? t("auth.signup.creatingAccount")
              : t("auth.signup.createAccount")}
          </button>
          {createBlockedReason ? (
            <p id="signup-create-blocked" className="-mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
              {createBlockedReason}
            </p>
          ) : null}

          <button
            key="password-back"
            type="button"
            onClick={() => {
              setError(null);
              setFocusIdentityOnReturn(true);
              setStep(1);
            }}
            className="mt-1 inline-flex min-h-6 items-center justify-center text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.signup.back")}
          </button>
        </>
      )}
    </form>
  );
}

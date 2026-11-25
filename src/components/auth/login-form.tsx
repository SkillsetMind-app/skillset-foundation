"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import {
  ConfirmEmailGate,
  ExpiredConfirmationLink,
} from "@/components/auth/confirm-email-gate";
import {
  completeMfaSignIn,
  getAuthErrorMessage,
  getPendingSecondFactor,
  isEmailNotConfirmedError,
  isMultiFactorRequiredError,
  type MfaRequiredError,
  signInWithEmail,
  signInWithGoogle,
  signOutOfSkillsetMind,
} from "@/lib/auth/supabase-auth";
import {
  getAuthRoute,
  getAuthPathIntentFromSearchParams,
  getEntryReturnTo,
  getLoadingRoute,
  getOnboardedReturnTo,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";

type LoginError = { key: string } | { cause: unknown } | null;

export function LoginForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // Deep link the sign-in wall captured (e.g. /learn/courses/x). Honored only
  // for onboarded accounts — first-time users still go through /welcome.
  const returnTo = useMemo(() => getEntryReturnTo(searchParams), [searchParams]);
  const signupHref = getAuthRoute("signup", pathIntent, returnTo);
  // Whoever arrived through the wrong entry switches role here, carrying along the
  // destination that the login gate captured.
  const isEducator = pathIntent === "teacher";
  const switchHref = getAuthRoute(
    "signin",
    isEducator ? "student" : "teacher",
    returnTo,
  );
  // Auth callback failures (expired/invalid recovery or OAuth links) arrive as
  // ?error= — without seeding it here they failed with no visible message.
  // Distinct reasons get distinct copy: collapsing them all into "expired"
  // sent users re-requesting links to fix a problem a new link can't fix.
  const callbackError = useMemo<LoginError>(() => {
    const reason = searchParams.get("error");
    if (!reason) return null;
    if (reason === "auth_callback") {
      return { key: "authFlow.callback.sameBrowser" };
    }
    // The proxy ended a session the account no longer accepts (suspended,
    // restored, or an accepted invite that required signing in again).
    if (reason === "session_revoked") {
      return { key: "authFlow.errors.sessionRevoked" };
    }
    // It has its own screen (below), not a red line.
    if (reason === "confirm_expired") {
      return null;
    }
    if (reason === "otp_expired" || reason === "access_denied") {
      return { key: "authFlow.callback.usedOrExpired" };
    }
    return { key: "authFlow.callback.invalidOrExpired" };
  }, [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginError>(callbackError);
  const errorMessage = error
    ? "key" in error ? t(error.key) : getAuthErrorMessage(error.cause, t)
    : "";
  // Account created, email never confirmed: instead of an error sentence, the
  // same gate as signup (with "resend the link").
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  // Expired or already used confirmation link: first the screen to ask for another,
  // with "already confirmed? sign in" for whoever only needs the form.
  const [expiredLink, setExpiredLink] = useState(
    () => searchParams.get("error") === "confirm_expired",
  );
  const [isLoading, setIsLoading] = useState(false);
  // Which entry was pressed, only for the label: both buttons stay
  // locked together by isLoading, but only the clicked one says it is working
  // (before, Google made the email button say "Signing in...").
  const [pendingMethod, setPendingMethod] = useState<"email" | "google" | null>(null);
  // Set when a sign-in succeeds at the password step but the account also
  // requires a TOTP second factor. Holds the original error the resolver needs.
  const [mfaError, setMfaError] = useState<MfaRequiredError | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  // Turnstile token — empty unless the widget is enabled (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  // aal1 session left in the cookie by whoever closed the code screen (the provider
  // exposes it as `mfa_required`): resumes the challenge instead of asking for the password
  // again. It is the only exit from that state. If the read fails, the password form
  // stays, which was the usual path.
  useEffect(() => {
    let cancelled = false;

    void getPendingSecondFactor()
      .then((pending) => {
        if (!cancelled && pending) {
          setMfaError(pending);
          setMfaCode("");
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  async function finishLogin(uid: string) {
    const profile = await getUserProfile(uid);
    router.push(
      profile?.onboardingCompleted
        ? getOnboardedReturnTo(profile, returnTo, pathIntent) ?? getLoadingRoute("route", pathIntent)
        // Not onboarded yet: the deep link goes with them through the wizard
        // instead of dying at its door.
        : getLoadingRoute("welcome", pathIntent, returnTo),
    );
  }

  async function handleEmailLogin() {
    setError(null);
    setPendingMethod("email");
    setIsLoading(true);

    try {
      const user = await signInWithEmail(
        { email, password },
        captchaToken || undefined,
      );
      await finishLogin(user.uid);
    } catch (caughtError) {
      if (isMultiFactorRequiredError(caughtError)) {
        setMfaError(caughtError);
        setMfaCode("");
        setError(null);
      } else if (isEmailNotConfirmedError(caughtError)) {
        setUnconfirmedEmail(email);
        setError(null);
      } else {
        // Turnstile tokens are single-use — refresh for the retry.
        if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
        setError({ cause: caughtError });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setPendingMethod("google");
    setIsLoading(true);

    try {
      const user = await signInWithGoogle(
        // Carried through the OAuth round trip: /loading applies the same
        // onboarded-or-welcome rule finishLogin applies for email.
        getLoadingRoute("welcome", pathIntent, returnTo),
      );
      await finishLogin(user.uid);
    } catch (caughtError) {
      if (isMultiFactorRequiredError(caughtError)) {
        setMfaError(caughtError);
        setMfaCode("");
        setError(null);
      } else {
        setError({ cause: caughtError });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMfaSubmit() {
    if (!mfaError || mfaCode.length < 6) {
      setError({ key: "auth.mfaCodePrompt" });
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const user = await completeMfaSignIn(mfaError, mfaCode);
      await finishLogin(user.uid);
    } catch (caughtError) {
      // Stay on the challenge so a mistyped code can be retried.
      setError({ cause: caughtError });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUseDifferentAccount() {
    setError(null);
    setIsLoading(true);
    try {
      // Really sign out. The aal1 session has been in the cookie since the password; only
      // hiding the code screen left that session alive for the next
      // access.
      await signOutOfSkillsetMind();
      setMfaError(null);
      setMfaCode("");
    } catch (caughtError) {
      setError({ cause: caughtError });
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

  if (expiredLink) {
    return (
      <ExpiredConfirmationLink
        intent={pathIntent}
        returnTo={returnTo}
        onSignIn={(typed) => {
          setEmail(typed);
          setExpiredLink(false);
        }}
      />
    );
  }

  if (unconfirmedEmail) {
    return (
      <ConfirmEmailGate
        email={unconfirmedEmail}
        intent={pathIntent}
        returnTo={returnTo}
        onChangeEmail={() => setUnconfirmedEmail("")}
      />
    );
  }

  // Second-factor challenge: shown after the password verifies but the account
  // has TOTP enrolled. Resolving here is what keeps 2FA from locking anyone out.
  if (mfaError) {
    return (
      <form className="mt-5 grid gap-3.5" onSubmit={handleSubmit}>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("auth.mfaTitle")}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("auth.mfaSubtitle")}
          </p>
        </div>
        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("auth.mfaCodeLabel")}
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
        {error ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
        <button
          type="submit"
          disabled={isLoading || mfaCode.length < 6}
          className="button-solid mt-2 px-4 py-2.5 text-sm"
        >
          {isLoading ? t("auth.verifying") : t("auth.verify")}
        </button>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            void handleUseDifferentAccount();
          }}
          className="min-h-6 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-60"
        >
          {t("auth.useDifferentAccount")}
        </button>
      </form>
    );
  }

  // The same order as signup: email first, then "or" and Google. Before,
  // Google came on top here and at the bottom on signup.
  return (
    <form className="mt-5 grid gap-3.5" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
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
      {/* "Forgot password?" lives outside the <label>: inside it the screen reader
          announced the field as "Password Forgot password?". */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="login-password"
            className="text-sm font-semibold text-[var(--color-ink)]"
          >
            {t("auth.password")}
          </label>
          <Link
            href="/forgot-password"
            className="auth-text-link text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <span className="relative block">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="current-password"
            required
            className="field-input pr-11"
          />
          <PasswordVisibilityToggle
            visible={showPassword}
            onToggle={() => setShowPassword((visible) => !visible)}
          />
        </span>
      </div>
      {/* The house notice (with icon) announces the same way: role="alert", assertive. */}
      {error ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
      <button
        type="submit"
        disabled={isLoading || (isCaptchaEnabled && !captchaToken)}
        className="button-solid mt-2 px-4 py-2.5 text-sm"
      >
        {isLoading && pendingMethod === "email" ? t("auth.signingIn") : t("auth.signIn")}
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
            onClick={handleGoogleLogin}
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
        href={signupHref}
        className="auth-text-link text-sm font-semibold text-[var(--color-primary)]"
      >
        {t("auth.createAccount")}
      </Link>
      <Link
        href={switchHref}
        className="auth-text-link text-sm font-semibold text-[var(--color-primary)]"
      >
        {t(isEducator ? "auth.switchToLearner" : "auth.switchToEducator")}
      </Link>
    </form>
  );
}

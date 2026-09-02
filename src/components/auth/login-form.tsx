"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import {
  completeMfaSignIn,
  getAuthErrorMessage,
  getPendingSecondFactor,
  isMultiFactorRequiredError,
  type MfaRequiredError,
  signInWithEmail,
  signInWithGoogle,
  signOutOfSkillsetMind,
} from "@/lib/auth/supabase-auth";
import {
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
  getSafeReturnTo,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";

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
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);
  const accessLabel = t(
    pathIntent === "teacher" ? "auth.educatorAccess" : "auth.learnerAccess",
  );
  const signupHref = pathIntent
    ? `/auth?mode=signup&path=${pathIntent}`
    : "/auth?mode=signup";
  // Auth callback failures (expired/invalid recovery or OAuth links) arrive as
  // ?error= — without seeding it here they failed with no visible message.
  // Distinct reasons get distinct copy: collapsing them all into "expired"
  // sent users re-requesting links to fix a problem a new link can't fix.
  const callbackError = useMemo(() => {
    const reason = searchParams.get("error");
    if (!reason) return "";
    if (reason === "auth_callback") {
      return "This link has to be opened in the same browser that requested it. Open it there, or request a new one from this browser.";
    }
    if (reason === "otp_expired" || reason === "access_denied") {
      return "That link has already been used or has expired. Reset links work once. Request a new one and try again.";
    }
    return "That link is invalid or has expired. Request a new one and try again.";
  }, [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(callbackError);
  const [isLoading, setIsLoading] = useState(false);
  // Set when a sign-in succeeds at the password step but the account also
  // requires a TOTP second factor. Holds the original error the resolver needs.
  const [mfaError, setMfaError] = useState<MfaRequiredError | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  // Turnstile token — empty unless the widget is enabled (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  // Sessão aal1 deixada no cookie por quem fechou a tela do código (o provider
  // a expõe como `mfa_required`): retoma o desafio em vez de pedir a senha de
  // novo. É a única saída desse estado. Se a leitura falhar, fica o formulário
  // de senha, que era o caminho de sempre.
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
        ? returnTo ?? getLoadingRoute("route", pathIntent)
        : getLoadingRoute("welcome", pathIntent),
    );
  }

  async function handleEmailLogin() {
    setError("");
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
        setError("");
      } else {
        // Turnstile tokens are single-use — refresh for the retry.
        if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
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
      setError(t("auth.mfaCodePrompt"));
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

  async function handleUseDifferentAccount() {
    setError("");
    setIsLoading(true);
    try {
      // Sair de verdade. A sessão aal1 está no cookie desde a senha; só
      // esconder a tela do código deixava essa sessão viva para o próximo
      // acesso.
      await signOutOfSkillsetMind();
      setMfaError(null);
      setMfaCode("");
    } catch (caughtError) {
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
          disabled={isLoading || mfaCode.length < 6}
          className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isLoading ? t("auth.verifying") : t("auth.verify")}
        </button>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            void handleUseDifferentAccount();
          }}
          className="text-sm font-semibold text-[var(--color-primary)] disabled:opacity-60"
        >
          {t("auth.useDifferentAccount")}
        </button>
      </form>
    );
  }

  return (
    <form className="mt-5 grid gap-3.5" onSubmit={handleSubmit}>
      <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {accessLabel}
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("auth.accessSubtitle")}
        </p>
      </div>
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
      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
        <span className="flex items-center justify-between gap-2">
          {t("auth.password")}
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.forgotPassword")}
          </Link>
        </span>
        <span className="relative block">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="current-password"
            required
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
      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
      <button
        type="submit"
        disabled={isLoading || (isCaptchaEnabled && !captchaToken)}
        className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {isLoading ? t("auth.signingIn") : t("auth.signIn")}
      </button>
      {isGoogleAuthEnabled ? (
        <button
          type="button"
          disabled={isLoading}
          onClick={handleGoogleLogin}
          className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
        >
          <GoogleMark />
          {t("auth.continueWithGoogle")}
        </button>
      ) : null}
      <Link
        href={signupHref}
        className="inline-flex text-sm font-semibold text-[var(--color-primary)]"
      >
        {t("auth.createAccount")}
      </Link>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
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
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<{ key: string } | { cause: unknown } | null>(null);
  const errorMessage = error
    ? "key" in error ? t(error.key) : getAuthErrorMessage(error.cause, t)
    : "";
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordReady = isStrongPassword(password);
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;
  // Por que "Update password" está apagado (a trava é a mesma; só passa a ser
  // dita). Senhas diferentes já têm a frase delas embaixo da confirmação: o
  // botão aponta para ela, em vez de repeti-la.
  const updateBlockedReason = !passwordReady
    ? t("auth.signup.choosePasswordFirst")
    : !passwordsMatch && !showMismatch
      ? t("auth.signup.confirmPasswordFirst")
      : "";
  const updateDescribedBy = updateBlockedReason
    ? "reset-password-blocked"
    : showMismatch
      ? "reset-password-mismatch"
      : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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
      await completePasswordRecovery(password);
      setIsDone(true);
    } catch (caughtError) {
      setError({ cause: caughtError });
    } finally {
      setIsLoading(false);
    }
  }

  // O titulo grande da pagina diz o estado (A-12): antes "Choose a new
  // password" ficava fixo em cima do link vencido e do "senha atualizada".
  const choosingHeading = (
    <>
      <h1 className="auth-title display-title">{t("authFlow.recovery.choosePassword")}</h1>
      <p className="auth-description">{t("authFlow.recovery.pageDescription")}</p>
    </>
  );

  // No recovery cookie (a regular signed-in session navigated here directly)
  // or no session at all (link expired, already used, or invalid) — either
  // way, refuse the no-current-password form.
  if (!recoveryVerified || status === "unauthenticated") {
    return (
      <>
        <h1 className="auth-title display-title">{t("auth.signup.expiredTitle")}</h1>
        <div className="mt-6 grid gap-4">
          <InlineAlert tone="error">{t("authFlow.recovery.invalid")}</InlineAlert>
          <Link
            href="/forgot-password"
            className="button-solid justify-self-start px-4 py-2.5 text-sm"
          >
            {t("authFlow.recovery.requestNew")}
          </Link>
        </div>
      </>
    );
  }

  if (status === "loading") {
    return (
      <>
        {choosingHeading}
        <p
          className="mt-6 text-sm leading-6 text-[var(--color-ink-soft)]"
          aria-busy="true"
        >
          {t("authFlow.recovery.checking")}
        </p>
      </>
    );
  }

  if (isDone) {
    return (
      <>
        <h1 className="auth-title display-title">{t("authFlow.recovery.updatedTitle")}</h1>
        <p role="status" aria-live="polite" className="auth-description">
          {t("authFlow.recovery.updated")}
        </p>
        <Link
          href="/account"
          className="button-solid mt-6 px-4 py-2.5 text-sm"
        >
          {t("authFlow.recovery.continue")}
        </Link>
      </>
    );
  }

  return (
    <>
      {choosingHeading}
      <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
        {/* Rotulo e campo lado a lado (htmlFor), com o olho fora do
            <label>: dentro dele, o nome do botao entrava no nome do campo. */}
        <div className="grid gap-2">
          <label htmlFor="reset-new-password" className="text-sm font-semibold text-[var(--color-ink)]">
            {t("authFlow.recovery.newPassword")}
          </label>
          <span className="relative block">
            <input
              id="reset-new-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("authFlow.recovery.newPasswordPlaceholder")}
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              aria-describedby="reset-password-rules"
              className="field-input pr-11"
            />
            <PasswordVisibilityToggle
              visible={showPassword}
              onToggle={() => setShowPassword((visible) => !visible)}
            />
          </span>
        </div>
        {/* As regras desde o inicio (as que faltam, apagadas) e fora do <label>,
            como no cadastro: antes surgiam na 1a letra, empurravam o resto e
            entravam no nome do campo. */}
        <div id="reset-password-rules" className="-mt-2">
          <PasswordStrengthChecklist password={password} />
        </div>
        <div className="grid gap-2">
          <label htmlFor="reset-confirm-password" className="text-sm font-semibold text-[var(--color-ink)]">
            {t("authFlow.recovery.confirmPassword")}
          </label>
          <span className="relative block">
            <input
              id="reset-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t("authFlow.recovery.confirmPasswordPlaceholder")}
              autoComplete="new-password"
              required
              aria-invalid={showMismatch}
              aria-describedby={showMismatch ? "reset-password-mismatch" : undefined}
              className="field-input pr-11"
            />
            <PasswordVisibilityToggle
              visible={showConfirmPassword}
              onToggle={() => setShowConfirmPassword((visible) => !visible)}
            />
          </span>
        </div>
        {showMismatch ? (
          <span
            id="reset-password-mismatch"
            className="-mt-2 text-xs font-semibold text-[var(--color-danger-fg)]"
          >
            {t("auth.signup.passwordsDontMatch")}
          </span>
        ) : null}
        {error ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
        <button
          type="submit"
          disabled={isLoading || !passwordReady || !passwordsMatch}
          aria-describedby={updateDescribedBy}
          className="button-solid mt-2 px-4 py-2.5 text-sm"
        >
          {t(isLoading ? "authFlow.recovery.updating" : "authFlow.recovery.update")}
        </button>
        {updateBlockedReason ? (
          <p id="reset-password-blocked" className="-mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {updateBlockedReason}
          </p>
        ) : null}
      </form>
    </>
  );
}

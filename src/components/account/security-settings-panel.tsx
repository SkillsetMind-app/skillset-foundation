"use client";

import { useState } from "react";

import { TotpMfaSection } from "@/components/account/totp-mfa-section";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle";
import {
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  changeSkillsetPassword,
  getAuthErrorMessage,
  isEmailRateLimitError,
  isMultiFactorRequiredError,
  requestSkillsetEmailChange,
  refreshCurrentUserEmailVerification,
  resetPassword,
  sendSkillsetEmailVerification,
} from "@/lib/auth/supabase-auth";

// Onde cada resposta aparece: logo abaixo do botão que a pediu. Antes havia um
// par message/error só, desenhado depois da grade inteira E do cartão de dois
// fatores — abaixo do `lg`, uma tela inteira longe do botão — e a tela rolava
// até ele. "Email me a reset link" era o pior caso: o e-mail saía e nada
// parecia acontecer.
type FeedbackSlot = "verification" | "email" | "password" | "reset";
type SecurityAction = "verificationSend" | "verificationRefresh" | "email" | "password" | "reset";
type Feedback =
  | { slot: FeedbackSlot; message: string }
  | { slot: FeedbackSlot; error: { key: string } | { cause: unknown } };

export function SecuritySettingsPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified ?? false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNextPassword, setShowNextPassword] = useState(false);
  // Qual ação está em andamento, para só o botão apertado trocar o texto.
  // Todos continuam travados juntos: o token do CAPTCHA abaixo é de uso único
  // e é dividido entre as três ações que vão ao GoTrue.
  const [busy, setBusy] = useState<SecurityAction | null>(null);
  const isBusy = busy !== null;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The password actions below and the verification resend go through GoTrue
  // endpoints that CAPTCHA protection guards (a password sign-in to
  // re-authenticate, the reset email, and the confirmation resend). Same widget as the login form: with no site key it renders nothing
  // and the token stays "", so with CAPTCHA off nothing here changes; with it
  // on, the token rides along instead of the calls dead-ending on "captcha
  // protection: request disallowed" with no widget in sight.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;
  const passwordReady = isStrongPassword(nextPassword);
  // Por que os dois botões estão apagados, quando falta algo que a pessoa
  // resolve (a trava é a mesma; só passa a ser dita). Ocupado não entra: o
  // botão já diz "Sending..."; a verificação de segurança mostra o próprio estado.
  const emailBlockedReason = newEmail.trim() ? "" : t("accountSecurity.email.typeFirst");
  const passwordBlockedReason = !currentPassword
    ? t("accountSecurity.password.currentFirst")
    : !passwordReady
      ? t("accountSecurity.password.chooseFirst")
      : "";

  async function handleSendVerification() {
    setBusy("verificationSend");
    setFeedback(null);

    try {
      await sendSkillsetEmailVerification(captchaToken || undefined);
      setFeedback({ slot: "verification", message: "accountSecurity.verification.sent" });
    } catch {
      setFeedback({ slot: "verification", error: { key: "accountSecurity.verification.sendError" } });
    } finally {
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setBusy(null);
    }
  }

  async function handleRefreshVerification() {
    setBusy("verificationRefresh");
    setFeedback(null);

    try {
      const verified = await refreshCurrentUserEmailVerification();
      setEmailVerified(verified);
      setFeedback({
        slot: "verification",
        message: verified
          ? "accountSecurity.verification.confirmed"
          : "accountSecurity.verification.pending",
      });
    } catch {
      setFeedback({ slot: "verification", error: { key: "accountSecurity.verification.refreshError" } });
    } finally {
      setBusy(null);
    }
  }

  async function handleEmailChangeRequest() {
    setBusy("email");
    setFeedback(null);

    try {
      await requestSkillsetEmailChange(newEmail);
      setFeedback({ slot: "email", message: "accountSecurity.email.sent" });
      setNewEmail("");
    } catch (caughtError) {
      setFeedback({ slot: "email", error: { cause: caughtError } });
    } finally {
      setBusy(null);
    }
  }

  async function handlePasswordChangeRequest() {
    if (!passwordReady) {
      setFeedback({ slot: "password", error: { key: "accountSecurity.password.requirementsError" } });
      return;
    }

    setBusy("password");
    setFeedback(null);

    try {
      await changeSkillsetPassword(
        currentPassword,
        nextPassword,
        captchaToken || undefined,
      );
      setCurrentPassword("");
      setNextPassword("");
      setFeedback({ slot: "password", message: "accountSecurity.password.updated" });
    } catch (caughtError) {
      // Re-authentication for a 2FA user triggers an MFA challenge this form
      // can't resolve. The reset-link path below sets a new password without
      // re-auth, so steer them there instead of showing a code prompt with no
      // field.
      setFeedback({
        slot: "password",
        error: isMultiFactorRequiredError(caughtError)
          ? { key: "accountSecurity.password.mfaResetHint" }
          : { cause: caughtError },
      });
    } finally {
      // Turnstile tokens are single-use — refresh for the next attempt.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setBusy(null);
    }
  }

  // Recovery path for a signed-in user who forgot their CURRENT password and
  // therefore can't use the change-password form (which re-authenticates).
  // Supabase emails a secure reset link — the password is never exposed and
  // no current password is required.
  async function handleSendPasswordReset() {
    if (!user?.email) {
      setFeedback({ slot: "reset", error: { key: "accountSecurity.password.noEmail" } });
      return;
    }

    setBusy("reset");
    setFeedback(null);

    try {
      await resetPassword(user.email, captchaToken || undefined);
      setFeedback({ slot: "reset", message: "accountSecurity.password.resetSent" });
    } catch (caughtError) {
      // Same call, same limit, same confusion as the reset page: hitting the
      // send cap means an earlier link already went out, so "Too many
      // attempts" points people at a failure that never happened.
      setFeedback(
        isEmailRateLimitError(caughtError)
          ? { slot: "reset", message: "accountSecurity.password.resetLimited" }
          : { slot: "reset", error: { cause: caughtError } },
      );
    } finally {
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setBusy(null);
    }
  }

  function feedbackFor(slot: FeedbackSlot, className = "mt-3") {
    if (feedback?.slot !== slot) return null;
    if ("message" in feedback) {
      return (
        <InlineAlert tone="info" className={className}>
          {t(feedback.message).replace("{email}", () => user?.email ?? "")}
        </InlineAlert>
      );
    }
    const { error } = feedback;
    return (
      <InlineAlert tone="error" className={className}>
        {"key" in error ? t(error.key) : getAuthErrorMessage(error.cause, t)}
      </InlineAlert>
    );
  }

  return (
    <section className="settings-section-card">
      <h2 className="text-lg font-bold text-[var(--color-ink)]">
        {t("accountSecurity.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("accountSecurity.description")}
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--color-ink)]">
                {t("accountSecurity.verification.title")}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                {t("accountSecurity.verification.description")}
              </p>
            </div>
            {/* "Required" e aviso, nao erro: as cores de aviso da plataforma,
                no lugar do rosa do vermelho antigo com texto dourado. */}
            <span
              className={`rounded-chip px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                emailVerified
                  ? "bg-white text-[var(--color-primary)]"
                  : "bg-[var(--color-warning-soft)] text-[var(--color-warning-fg)]"
              }`}
            >
              {t(emailVerified
                ? "accountSecurity.verification.verified"
                : "accountSecurity.verification.required")}
            </span>
          </div>
          {/* Já verificado, não há o que enviar nem conferir. Antes o botão
              mais forte da aba era "Refresh status", mesmo com o e-mail ok. */}
          {!emailVerified ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleSendVerification}
                disabled={isBusy || captchaPending}
              >
                <BusyLabel
                  busy={busy === "verificationSend"}
                  idle={t("accountSecurity.verification.send")}
                  busyText={t("accountSecurity.sending")}
                />
              </Button>
              <Button
                variant="outline"
                onClick={handleRefreshVerification}
                disabled={isBusy}
              >
                <BusyLabel
                  busy={busy === "verificationRefresh"}
                  idle={t("accountSecurity.verification.refresh")}
                  busyText={t("accountSecurity.checking")}
                />
              </Button>
            </div>
          ) : null}
          {feedbackFor("verification")}
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            {t("accountSecurity.email.title")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountSecurity.email.description").replace(
              "{email}",
              () => user?.email || t("accountSecurity.email.missing"),
            )}
          </p>
          <div className="mt-4 grid gap-3">
            <Field id="security-new-email" label={t("accountSecurity.email.label")}>
              {(a11y) => (
                <input
                  {...a11y}
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder={t("accountSecurity.email.placeholder")}
                  autoComplete="email"
                  className="field-input"
                />
              )}
            </Field>
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={handleEmailChangeRequest}
              disabled={isBusy || !newEmail.trim()}
              aria-describedby={emailBlockedReason ? "security-email-blocked" : undefined}
            >
              <BusyLabel busy={busy === "email"} idle={t("accountSecurity.email.send")} busyText={t("accountSecurity.sending")} />
            </Button>
            {emailBlockedReason ? (
              <p id="security-email-blocked" className="-mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                {emailBlockedReason}
              </p>
            ) : null}
          </div>
          {feedbackFor("email")}
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-white p-4">
          <p className="font-semibold text-[var(--color-ink)]">
            {t("accountSecurity.password.title")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountSecurity.password.description")}
          </p>
          <div className="mt-4 grid gap-3">
            <Field id="security-current-password" label={t("accountSecurity.password.current")}>
              {(a11y) => (
                <span className="relative block">
                  <input
                    {...a11y}
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    className="field-input pr-11"
                  />
                  <PasswordVisibilityToggle
                    visible={showCurrentPassword}
                    onToggle={() => setShowCurrentPassword((visible) => !visible)}
                  />
                </span>
              )}
            </Field>
            <Field id="security-new-password" label={t("accountSecurity.password.next")}>
              {(a11y) => (
                <span className="relative block">
                  <input
                    {...a11y}
                    // As regras abaixo sao a descricao do campo (o Field nao
                    // tem dica aqui, entao nao ha outra a perder).
                    aria-describedby="security-password-rules"
                    type={showNextPassword ? "text" : "password"}
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                    autoComplete="new-password"
                    className="field-input pr-11"
                  />
                  <PasswordVisibilityToggle
                    visible={showNextPassword}
                    onToggle={() => setShowNextPassword((visible) => !visible)}
                  />
                </span>
              )}
            </Field>
            {/* Visiveis desde o inicio (as que faltam, apagadas): antes so
                surgiam na 1a letra e empurravam o botao para baixo. */}
            <div id="security-password-rules">
              <PasswordStrengthChecklist password={nextPassword} />
            </div>
            <TurnstileWidget
              onToken={setCaptchaToken}
              resetSignal={captchaResetSignal}
            />
            <Button
              className="justify-self-start"
              onClick={handlePasswordChangeRequest}
              disabled={
                isBusy || !currentPassword || !passwordReady || captchaPending
              }
              aria-describedby={passwordBlockedReason ? "security-password-blocked" : undefined}
            >
              <BusyLabel busy={busy === "password"} idle={t("accountSecurity.password.update")} busyText={t("accountSecurity.updating")} />
            </Button>
            {passwordBlockedReason ? (
              <p id="security-password-blocked" className="-mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                {passwordBlockedReason}
              </p>
            ) : null}
            {feedbackFor("password", "")}
            <div className="mt-1 border-t border-[var(--color-line)] pt-3">
              <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                {t("accountSecurity.password.forgot")}
              </p>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={isBusy || captchaPending}
                className="group/reset mt-1 min-h-11 text-sm font-bold text-[var(--color-primary)] underline-offset-2 disabled:opacity-60"
              >
                {/* O sublinhado do hover não atravessa o inline-grid do
                    BusyLabel (caixa atômica): ele mesmo se sublinha quando o
                    botão está sob o ponteiro. */}
                <BusyLabel
                  busy={busy === "reset"}
                  idle={t("accountSecurity.password.sendReset")}
                  busyText={t("accountSecurity.sending")}
                  className="group-hover/reset:underline"
                />
              </button>
              {feedbackFor("reset")}
            </div>
          </div>
        </div>

        <TotpMfaSection emailVerified={emailVerified} />
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getAuthRoute, getLoadingRoute, getSafeReturnTo, type AuthPathIntent } from "@/lib/auth/routing";
import {
  getAuthErrorMessage,
  isAccountNeutralAuthError,
  refreshCurrentUserEmailVerification,
  resendSignupConfirmation,
} from "@/lib/auth/supabase-auth";

const RESEND_COOLDOWN_SECONDS = 60;
const CONFIRMED_CHECK_MS = 6000;

// Espera entre reenvios, para o botao nao virar fonte de spam. A mesma para as
// duas telas que reenviam o link.
function useResendCooldown() {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  return [cooldown, () => setCooldown(RESEND_COOLDOWN_SECONDS)] as const;
}

// A porta "confirme seu e-mail", logo depois de criar a conta (e tambem quando
// alguem tenta entrar sem ter confirmado).
//
// POR QUE ISTO EXISTE
//
// A tela anterior dizia "abra o link, depois volte e entre" e oferecia um
// botao "ir para o login". Se o e-mail nao chegava — spam, endereco errado,
// atraso — nao havia o que fazer: o login devolvia "e-mail nao confirmado" e
// pronto. Cinco contas reais ficaram paradas assim. Agora: reenviar (com
// espera de 60 s para nao virar spam), trocar o e-mail, e a promessa do que
// vem depois (o perfil), para a pessoa saber que vale a pena clicar.
export function ConfirmEmailGate({
  email,
  intent = null,
  returnTo = null,
  onChangeEmail,
}: {
  email: string;
  intent?: AuthPathIntent | null;
  returnTo?: string | null;
  /** Volta ao formulario com o e-mail preenchido, para corrigir. */
  onChangeEmail?: () => void;
}) {
  const { t } = useTranslation();
  const [cooldown, startCooldown] = useResendCooldown();
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  // The resend is CAPTCHA-guarded like sign-up, and the form's token was
  // already spent creating the account, so this gate needs its own widget.
  // Renders nothing (token stays "") when no site key is set.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;
  // Same destination as the link in the email: /loading decides between
  // onboarding and the deep link.
  const confirmedRoute = getLoadingRoute(
    "welcome",
    intent,
    getSafeReturnTo(new URLSearchParams({ returnTo: returnTo ?? "" })),
  );

  // Confirmou em outra aba (o link do e-mail abre ao lado)? Esta aba nao
  // ficava sabendo e esperava para sempre. Olha de novo a cada poucos segundos
  // e quando a aba volta ao foco — nunca escondida, nunca depois de sair. So
  // conta a sessao DESTE e-mail: outra conta logada ao lado nao puxa esta aba.
  // Navegacao completa, nao router: o provider de sessao desta aba ainda acha
  // que ninguem entrou, e so recarregando ele le o cookie novo.
  // ponytail: outro APARELHO (celular) nao deixa sessao nesta aba, entao isto
  // nao o enxerga; para isso segue o link "ja confirmei? entrar".
  useEffect(() => {
    let done = false;

    async function check() {
      if (done || document.visibilityState === "hidden") {
        return;
      }
      try {
        if ((await refreshCurrentUserEmailVerification(email)) && !done) {
          done = true;
          window.location.assign(confirmedRoute);
        }
      } catch {
        // Offline or a transient failure: the next tick tries again.
      }
    }

    const onWake = () => void check();
    const timer = window.setInterval(onWake, CONFIRMED_CHECK_MS);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      done = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [confirmedRoute, email]);

  async function handleResend() {
    if (isSending || cooldown > 0 || captchaPending) {
      return;
    }
    setIsSending(true);
    setError(null);
    setSent(false);
    try {
      await resendSignupConfirmation(
        email,
        confirmedRoute,
        captchaToken || undefined,
      );
      setSent(true);
      startCooldown();
    } catch (caughtError) {
      setError({ cause: caughtError });
    } finally {
      // Turnstile tokens are single-use — refresh for the next attempt.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsSending(false);
    }
  }

  return (
    <section
      className="mt-5 grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-6"
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

      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={isSending || cooldown > 0 || captchaPending}
          className="min-h-11 rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-base)] disabled:opacity-60"
        >
          {cooldown > 0
            ? t("auth.signup.confirmResendIn").replace("{seconds}", String(cooldown))
            : isSending
              ? t("auth.signup.confirmResending")
              : t("auth.signup.confirmResend")}
        </button>
        {onChangeEmail ? (
          <button
            type="button"
            onClick={onChangeEmail}
            className="min-h-11 rounded-md border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]"
          >
            {t("auth.signup.confirmChangeEmail")}
          </button>
        ) : null}
      </div>

      {sent ? (
        <p className="text-xs font-semibold text-[var(--color-primary)]">{t("auth.signup.confirmResent")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
          {getAuthErrorMessage(error.cause, t)}
        </p>
      ) : null}

      <p className="text-xs leading-5 text-[var(--color-ink-muted)]">
        {t("auth.signup.confirmAlreadyDone")}{" "}
        <Link href={getAuthRoute("signin", intent, returnTo)} className="font-semibold text-[var(--color-primary)]">
          {t("auth.signup.confirmSignIn")}
        </Link>
      </p>
    </section>
  );
}

// Link de confirmacao vencido ou ja usado (o login abre isto com
// ?error=confirm_expired). Antes a pessoa caia num texto sobre "links de troca
// de senha" e sem botao de reenviar: beco sem saida. Aqui ela digita o e-mail e
// pede outro link, pelo MESMO reenvio da porta acima (CAPTCHA, espera de 60 s e
// o limite do proprio Supabase).
//
// A resposta e sempre a mesma frase, exista a conta ou nao, ja confirmada ou
// nao: esta tela nao pode servir para descobrir quem tem cadastro. So aparece
// erro do que acontece antes de procurar a conta (CAPTCHA, conexao).
export function ExpiredConfirmationLink({
  intent = null,
  returnTo = null,
  onSignIn,
}: {
  intent?: AuthPathIntent | null;
  returnTo?: string | null;
  /** Ja confirmou: volta ao formulario de entrada com o e-mail digitado. */
  onSignIn: (email: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [cooldown, startCooldown] = useResendCooldown();
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || cooldown > 0 || captchaPending || !email.trim()) {
      return;
    }
    setIsSending(true);
    setError(null);
    setSent(false);
    try {
      await resendSignupConfirmation(
        email.trim(),
        // O link novo leva ao mesmo lugar que o vencido: o curso, se havia.
        getLoadingRoute("welcome", intent, getSafeReturnTo(new URLSearchParams({ returnTo: returnTo ?? "" }))),
        captchaToken || undefined,
      );
      setSent(true);
      startCooldown();
    } catch (caughtError) {
      if (isAccountNeutralAuthError(caughtError)) {
        setError({ cause: caughtError });
      } else {
        // Limite, conta inexistente, ja confirmada: mesma frase de sempre.
        setSent(true);
        startCooldown();
      }
    } finally {
      // O token do CAPTCHA vale uma vez: renova para a proxima tentativa.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsSending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSend(event)}
      className="mt-5 grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-6"
    >
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">
        {t("auth.signup.expiredTitle")}
      </h2>
      <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("auth.signup.expiredBody")}
      </p>
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

      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />

      <button
        type="submit"
        disabled={isSending || cooldown > 0 || captchaPending}
        className="min-h-11 rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-base)] disabled:opacity-60"
      >
        {cooldown > 0
          ? t("auth.signup.confirmResendIn").replace("{seconds}", String(cooldown))
          : isSending
            ? t("auth.signup.confirmResending")
            : t("auth.signup.expiredSend")}
      </button>

      {sent ? (
        <p role="status" className="text-sm font-semibold text-[var(--color-primary)]">{t("auth.signup.expiredSent")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-[var(--color-danger-fg)]">
          {getAuthErrorMessage(error.cause, t)}
        </p>
      ) : null}

      <p className="text-sm leading-6 text-[var(--color-ink-muted)]">
        {t("auth.signup.confirmAlreadyDone")}{" "}
        <button
          type="button"
          onClick={() => onSignIn(email.trim())}
          className="min-h-6 font-semibold text-[var(--color-primary)]"
        >
          {t("auth.signup.confirmSignIn")}
        </button>
      </p>
    </form>
  );
}

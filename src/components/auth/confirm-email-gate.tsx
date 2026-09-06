"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  getAuthErrorMessage,
  resendSignupConfirmation,
} from "@/lib/auth/supabase-auth";

const RESEND_COOLDOWN_SECONDS = 60;

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
  onChangeEmail,
}: {
  email: string;
  /** Volta ao formulario com o e-mail preenchido, para corrigir. */
  onChangeEmail?: () => void;
}) {
  const { t } = useTranslation();
  const [cooldown, setCooldown] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    if (isSending || cooldown > 0) {
      return;
    }
    setIsSending(true);
    setError(null);
    setSent(false);
    try {
      await resendSignupConfirmation(email);
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caughtError) {
      setError({ cause: caughtError });
    } finally {
      setIsSending(false);
    }
  }

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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={isSending || cooldown > 0}
          className="rounded-[10px] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-base)] disabled:opacity-60"
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
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]"
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
        <Link href="/auth?mode=signin" className="font-semibold text-[var(--color-primary)]">
          {t("auth.signup.confirmSignIn")}
        </Link>
      </p>
    </section>
  );
}

"use client";

import { useState, type FormEvent } from "react";

import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import {
  getAuthErrorMessage,
  isEmailRateLimitError,
  resetPassword,
} from "@/lib/auth/supabase-auth";

export function ResetPasswordForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [success, setSuccess] = useState<"sent" | "limited" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Turnstile token — empty unless the widget is enabled.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  // Bumped on every attempt so the feedback box remounts even when the copy is
  // identical to last time. Without it, a second submit changes nothing in the
  // DOM and reads as "the button did nothing" — the reported bug.
  const [feedbackSeq, setFeedbackSeq] = useState(0);

  // The feedback box is inserted mid-form, above the button the user just
  // pressed, so on a phone it can land behind the soft keyboard or above the
  // fold. Dropping focus closes the keyboard and the callback ref pulls the
  // box into view.
  const revealFeedback = (node: HTMLParagraphElement | null) => {
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      await resetPassword(email, captchaToken || undefined);
      setSuccess("sent");
    } catch (caughtError) {
      // The send limit only trips because an earlier link already went out, so
      // reporting it as a failure sends people looking for a problem that
      // isn't there — the same "did anything happen?" confusion this form was
      // reported for. Say the link is already on its way.
      if (isEmailRateLimitError(caughtError)) {
        setSuccess("limited");
      } else {
        setError({ cause: caughtError });
      }
    } finally {
      // Single-use token: refresh for the next attempt either way.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setFeedbackSeq((n) => n + 1);
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleReset}>
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
      {error ? (
        <p
          key={`error-${feedbackSeq}`}
          ref={revealFeedback}
          role="alert"
          aria-live="assertive"
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {getAuthErrorMessage(error.cause, t)}
        </p>
      ) : null}
      {success ? (
        <p
          key={`success-${feedbackSeq}`}
          ref={revealFeedback}
          role="status"
          aria-live="polite"
          className="rounded-[10px] border border-[rgba(26,54,93,0.14)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]"
        >
          {t(`authFlow.recovery.${success}`)}
          {success === "sent" && isGoogleAuthEnabled ? t("authFlow.recovery.googleHint") : ""}
        </p>
      ) : null}
      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
      <button
        type="submit"
        disabled={isLoading || (isCaptchaEnabled && !captchaToken)}
        className="button-solid mt-2 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {t(isLoading ? "authFlow.recovery.sending" : "authFlow.recovery.send")}
      </button>
    </form>
  );
}

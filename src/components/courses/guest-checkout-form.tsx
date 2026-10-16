"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { GoogleMark } from "@/components/auth/google-mark";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isPlatformHost } from "@/domain/host-routing";
import { isGoogleAuthEnabled } from "@/lib/auth/providers";
import { getLoadingRoute } from "@/lib/auth/routing";
import { signInWithGoogle } from "@/lib/auth/supabase-auth";
import { startGuestCourseCheckout } from "@/lib/payments/checkout";
import { PaymentRequestError } from "@/lib/payments/client-fetch";

const fieldClass =
  "mt-1.5 w-full rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]";
const labelClass = "text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]";
const errorClass =
  "rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]";

const noSubscription = () => () => {};

/**
 * Whether this page is served on the platform's own host. Guest checkout is
 * offered only there: on a creator's own domain the page keeps sign-in and
 * sign-up, like every identity surface (see domain/host-routing). False on the
 * server render, so the form only appears once the browser knows its host.
 */
export function useOnPlatformHost(): boolean {
  return useSyncExternalStore(noSubscription, () => isPlatformHost(window.location.hostname), () => false);
}

const turnstileSizeFor = (width: number) => (width < 300 ? "compact" : "normal");

type GuestCheckoutFormProps = {
  courseId: string;
  offerId?: string;
  offerCode?: string;
  priceId?: string;
  /** This checkout page, to come back to after Google or signing in. */
  returnTo: string;
  submitLabel: string;
  disabled: boolean;
  /** The course page's mapping of checkout API errors to copy. */
  errorKeyFor: (error: unknown) => string;
  onSubmitStart?: () => void;
};

// Buy without an account: name, e-mail, terms and the bot check, then straight
// to Stripe. Signing in (password or Google) stays one click away.
export function GuestCheckoutForm({
  courseId,
  offerId,
  offerCode,
  priceId,
  returnTo,
  submitLabel,
  disabled,
  errorKeyFor,
  onSubmitStart,
}: GuestCheckoutFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorKey, setErrorKey] = useState("");
  const [linkSent, setLinkSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSubmitting) return;
    if (!accepted) {
      setErrorKey("guestCheckout.form.acceptTerms");
      return;
    }
    if (!captchaToken) {
      setErrorKey("guestCheckout.form.captchaPending");
      return;
    }
    setErrorKey("");
    setLinkSent(false);
    setIsSubmitting(true);
    onSubmitStart?.();
    try {
      const outcome = await startGuestCourseCheckout({
        courseId,
        name: name.trim(),
        email: email.trim(),
        captchaToken,
        offerId,
        offerCode,
        priceId,
      });
      // Stripe is loading: keep the button busy until the page unloads.
      if (outcome === "redirected") return;
      setLinkSent(true);
    } catch (error) {
      const code = error instanceof PaymentRequestError ? error.code : undefined;
      setErrorKey(
        code === "captcha_failed"
          ? "guestCheckout.form.captchaFailed"
          : code === "invalid_request"
            ? "guestCheckout.form.invalid"
            : code === "checkout_pending"
              ? "guestCheckout.form.checkoutPending"
              : code === "send_failed"
                ? "guestCheckout.form.sendFailed"
                : errorKeyFor(error),
      );
    }
    // A Turnstile token works once.
    setCaptchaReset((n) => n + 1);
    setIsSubmitting(false);
  }

  async function handleGoogle() {
    setErrorKey("");
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle(getLoadingRoute("welcome", null, returnTo));
    } catch {
      setErrorKey("guestCheckout.form.googleFailed");
      setIsGoogleLoading(false);
    }
  }

  return (
    <div className="mt-6 grid gap-3">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <label className="block">
          <span className={labelClass}>{t("guestCheckout.form.name")}</span>
          <input
            data-cta-focus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoComplete="name"
            required
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{t("guestCheckout.form.email")}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            required
            className={fieldClass}
          />
        </label>
        <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5"
            required
          />
          <span>
            {t("auth.signup.agreePrefix")}
            <Link href="/legal/terms" target="_blank" rel="noreferrer" className="font-semibold text-[var(--color-primary)]">
              {t("footer.termsOfService")}
            </Link>
            {t("auth.signup.agreeMiddle")}
            <Link href="/legal/privacy" target="_blank" rel="noreferrer" className="font-semibold text-[var(--color-primary)]">
              {t("footer.privacyPolicy")}
            </Link>
            {t("auth.signup.agreeSuffix")}
          </span>
        </label>
        {/* The purchase card can be narrower than the 300px normal widget on a
            phone: compact (150px) there, so nothing renders off screen. */}
        <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} size={turnstileSizeFor} />
        <button
          type="submit"
          disabled={disabled || isSubmitting || isGoogleLoading}
          className="button-solid w-full justify-center px-5 py-2.5 text-sm disabled:opacity-60"
        >
          {isSubmitting ? t("publicCourses.openingCheckout") : submitLabel}
        </button>
        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{t("guestCheckout.form.accessByEmail")}</p>
      </form>

      {linkSent ? <p role="status" className="info-notice">{t("guestCheckout.form.linkSent")}</p> : null}
      {errorKey ? <p role="alert" className={errorClass}>{t(errorKey)}</p> : null}

      {isGoogleAuthEnabled ? (
        <>
          <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            <span className="h-px flex-1 bg-[var(--color-line)]" />
            {t("auth.signup.or")}
            <span className="h-px flex-1 bg-[var(--color-line)]" />
          </div>
          <button
            type="button"
            disabled={isSubmitting || isGoogleLoading}
            onClick={handleGoogle}
            className="button-outline w-full justify-center px-4 py-2.5 text-sm disabled:opacity-60"
          >
            <GoogleMark />
            {t("auth.continueWithGoogle")}
          </button>
        </>
      ) : null}

      <p className="text-center text-sm text-[var(--color-ink-soft)]">
        {t("guestCheckout.form.haveAccount")}{" "}
        <Link
          href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-[var(--color-primary)]"
        >
          {t("guestCheckout.form.signIn")}
        </Link>
      </p>
    </div>
  );
}

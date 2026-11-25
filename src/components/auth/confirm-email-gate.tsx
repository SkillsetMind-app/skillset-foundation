"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { usePageHeading } from "@/components/auth/page-heading";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpinnerRing } from "@/components/shared/skillset-spinner";
import { InlineAlert } from "@/components/ui/inline-alert";
import { getAuthRoute, getLoadingRoute, getSafeReturnTo, type AuthPathIntent } from "@/lib/auth/routing";
import {
  getAuthErrorMessage,
  isAccountNeutralAuthError,
  refreshCurrentUserEmailVerification,
  resendSignupConfirmation,
} from "@/lib/auth/supabase-auth";

const RESEND_COOLDOWN_SECONDS = 60;
const CONFIRMED_CHECK_MS = 6000;

// Wait between resends, so the button does not become a source of spam. The same for the
// two screens that resend the link.
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

// The "sent" line is always mounted (empty and out of the flow before the
// send) and only the TEXT comes and goes: a live region that is born full is usually not
// read. The number ticking on the button stays outside it, so the screen reader
// does not read "59s... 58s..."; when the wait ends, "you can ask for another" comes in
// on the same line.
function ResendStatus({ sent, cooldown, message }: { sent: boolean; cooldown: number; message: string }) {
  const { t } = useTranslation();
  return (
    <p role="status" className={sent ? "text-sm font-semibold text-[var(--color-primary)]" : "sr-only"}>
      {sent ? (
        <>
          {message}
          {cooldown > 0 ? null : <span className="sr-only"> {t("auth.signup.confirmResendReady")}</span>}
        </>
      ) : null}
    </p>
  );
}

// The "confirm your email" gate, right after creating the account (and also when
// someone tries to sign in without having confirmed).
//
// WHY THIS EXISTS
//
// The previous screen said "open the link, then come back and sign in" and offered a
// "go to login" button. If the email never arrived — spam, wrong address,
// delay — there was nothing to do: the login returned "email not confirmed" and
// that was it. Five real accounts were left stuck like this. Now: resend (with a
// 60 s wait so it does not become spam), change the email, and the promise of what
// comes next (the profile), so the person knows it is worth clicking.
export function ConfirmEmailGate({
  email,
  intent = null,
  returnTo = null,
  onChangeEmail,
}: {
  email: string;
  intent?: AuthPathIntent | null;
  returnTo?: string | null;
  /** Goes back to the form with the email filled in, to fix it. */
  onChangeEmail?: () => void;
}) {
  const { t } = useTranslation();
  // The big page title (/auth) stayed "Crie sua conta" on top of the
  // confirmation gate: with the gate on screen, it becomes "Check your email".
  usePageHeading({ titleKey: "auth.signup.checkEmailTitle" });
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

  // Confirmed in another tab (the email link opens next to it)? This tab did not
  // find out and waited forever. It checks again every few seconds
  // and when the tab regains focus — never while hidden, never after leaving. It only
  // counts the session of THIS email: another account signed in alongside does not pull this tab.
  // Full navigation, not the router: the session provider in this tab still thinks
  // nobody signed in, and only by reloading does it read the new cookie.
  // ponytail: another DEVICE (phone) leaves no session in this tab, so this
  // does not see it; for that there is the "already confirmed? sign in" link.
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

  // No aria-live on the whole section: the screen reader read "Resend in 59s...
  // 58s..." every second for a minute. Only the "sent again" and the
  // wait are announced. The instruction is the page title ("Check your
  // email"); "Resend" is no longer the full button, because it is not the next step.
  return (
    <section className="mt-5 grid gap-4">
      <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("auth.signup.confirmSentTo")}{" "}
        <strong className="font-semibold text-[var(--color-ink)]">{email}</strong>.{" "}
        {t("auth.signup.confirmBody")}
      </p>
      <p
        role="status"
        className="flex items-center gap-2.5 rounded-md bg-[var(--color-surface-soft)] px-3.5 py-3 text-sm font-semibold leading-5 text-[var(--color-ink)]"
      >
        {/* The house ring, at the same 16px as before (the "sm" one is 20px). */}
        <SpinnerRing size="sm" className="size-4! shrink-0" />
        {t("auth.signup.confirmWaiting")}
      </p>

      <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaResetSignal} />

      <div className="grid gap-1">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={isSending || cooldown > 0 || captchaPending}
          className="button-outline w-full"
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
            className="min-h-11 rounded-md px-4 text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
          >
            {t("auth.signup.confirmChangeEmail")}
          </button>
        ) : null}
      </div>

      <ResendStatus sent={sent} cooldown={cooldown} message={t("auth.signup.confirmResent")} />
      {error ? (
        <InlineAlert tone="error">
          {getAuthErrorMessage(error.cause, t)}
        </InlineAlert>
      ) : null}

      <p className="text-xs leading-5 text-[var(--color-ink-muted)]">
        {t("auth.signup.confirmAlreadyDone")}{" "}
        <Link href={getAuthRoute("signin", intent, returnTo)} className="auth-text-link font-semibold text-[var(--color-primary)]!">
          {t("auth.signup.confirmSignIn")}
        </Link>
      </p>
    </section>
  );
}

// Expired or already used confirmation link (the login opens this with
// ?error=confirm_expired). Before, the person landed on text about "password reset
// links" with no resend button: a dead end. Here they type the email and
// ask for another link, through the SAME resend as the gate above (CAPTCHA, 60 s wait and
// the limit of Supabase itself).
//
// The answer is always the same sentence, whether the account exists or not, already confirmed or
// not: this screen must not be usable to find out who has signed up. Only an
// error from what happens before looking up the account (CAPTCHA, connection) shows.
export function ExpiredConfirmationLink({
  intent = null,
  returnTo = null,
  onSignIn,
}: {
  intent?: AuthPathIntent | null;
  returnTo?: string | null;
  /** Already confirmed: goes back to the sign-in form with the typed email. */
  onSignIn: (email: string) => void;
}) {
  const { t } = useTranslation();
  // On /auth the notice becomes the page title ("Sign in as a learner." used to sit
  // on top of it). The own title only shows once the page already shows
  // its own: in the server HTML it is loose, and the screen keeps its own.
  const titleOnPage = usePageHeading({ titleKey: "auth.signup.expiredTitle" });
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
        // The new link leads to the same place as the expired one: the course, if there was one.
        getLoadingRoute("welcome", intent, getSafeReturnTo(new URLSearchParams({ returnTo: returnTo ?? "" }))),
        captchaToken || undefined,
      );
      setSent(true);
      startCooldown();
    } catch (caughtError) {
      if (isAccountNeutralAuthError(caughtError)) {
        setError({ cause: caughtError });
      } else {
        // Rate limit, nonexistent account, already confirmed: the same sentence as always.
        setSent(true);
        startCooldown();
      }
    } finally {
      // The CAPTCHA token is good once: renew it for the next attempt.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
      setIsSending(false);
    }
  }

  return (
    // Without the tinted card: the screen is the page itself, not a frame inside it.
    <form
      onSubmit={(event) => void handleSend(event)}
      className="mt-5 grid gap-3"
    >
      {titleOnPage ? null : (
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("auth.signup.expiredTitle")}
        </h2>
      )}
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
        className="button-solid w-full"
      >
        {cooldown > 0
          ? t("auth.signup.confirmResendIn").replace("{seconds}", String(cooldown))
          : isSending
            ? t("auth.signup.confirmResending")
            : t("auth.signup.expiredSend")}
      </button>

      <ResendStatus sent={sent} cooldown={cooldown} message={t("auth.signup.expiredSent")} />
      {error ? (
        <InlineAlert tone="error">
          {getAuthErrorMessage(error.cause, t)}
        </InlineAlert>
      ) : null}

      <p className="text-sm leading-6 text-[var(--color-ink-muted)]">
        {t("auth.signup.confirmAlreadyDone")}{" "}
        <button
          type="button"
          onClick={() => onSignIn(email.trim())}
          className="auth-text-link font-semibold text-[var(--color-primary)]"
        >
          {t("auth.signup.confirmSignIn")}
        </button>
      </p>
    </form>
  );
}

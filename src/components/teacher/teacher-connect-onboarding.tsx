"use client";

import Link from "next/link";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Card, Eyebrow, InlineAlert } from "@/components/ui";
import {
  fetchConnectAccountSessionSecret,
  isConnectNotEnabledError,
  startTeacherStripeOnboarding,
} from "@/lib/payments/connect";
import { useTheme } from "@/lib/theme/theme-provider";
import { PaymentRequestError } from "@/lib/payments/client-fetch";

/**
 * Renders Stripe's embedded creator-onboarding flow INSIDE SkillsetMind.
 * The creator completes KYC, identity, and bank-account verification
 * without ever being redirected to a Stripe-hosted page.
 *
 * Initialization shape:
 *   1. Read the publishable key from NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
 *   2. fetchClientSecret is called once at init AND once whenever Connect
 *      decides the session expired — same callable on the backend mints
 *      a fresh secret each time.
 *   3. <ConnectComponentsProvider> establishes context; the actual UI
 *      lives in <ConnectAccountOnboarding>. The component handles its
 *      own form, validation, and step navigation — SkillsetMind just owns
 *      the host page.
 *
 * onExit fires when the creator finishes (or escapes) onboarding. We
 * fire onComplete so the parent (TeacherWalletPanel) can refresh status.
 */

const publishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

/**
 * Stripe's Appearance API runs inside an iframe and can't read SkillsetMind's CSS
 * variables, so we hand it concrete hex values that mirror our design tokens
 * (globals.css :root for light, [data-theme="dark"] for dark). Without this the
 * embedded KYC flow renders a white box punched into the dark UI. Kept at module
 * scope so both the init effect and the live re-skin effect share one source.
 */
function buildConnectAppearance(theme: "light" | "dark") {
  const dark = theme === "dark";
  return {
    overlays: "dialog" as const,
    variables: {
      colorPrimary: dark ? "#8fb4e4" : "#1a365d",
      colorBackground: dark ? "#0f1626" : "#ffffff",
      colorText: dark ? "#e8edf5" : "#0f2744",
      colorDanger: dark ? "#e36b78" : "#b22234",
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      borderRadius: "10px",
    },
  };
}

type TeacherConnectOnboardingProps = {
  onComplete?: () => void;
  /**
   * Fires whenever this component learns whether the PLATFORM has Stripe
   * Connect enabled at all. Lets the parent (TeacherWalletPanel) stop
   * presenting a stored-but-unverifiable account id as "Connected" while
   * payouts are platform-unavailable.
   */
  onAvailabilityChange?: (payoutsUnavailable: boolean) => void;
};

function connectFailure(cause: unknown, fallback: "initialize" | "hosted") {
  const paymentError = cause instanceof PaymentRequestError ? cause : null;
  const code = paymentError?.code;
  const key = code === "activation_required" ? "activation"
    : code === "payments_not_configured" ? "configuration"
    : code === "unauthenticated" || paymentError?.status === 401 ? "signIn"
    : code === "permission_denied" || paymentError?.status === 403 ? "permission"
    : paymentError?.status === 429 ? "rateLimit"
    : fallback;
  return { key, status: paymentError?.status };
}

function connectRecoveryHref(key: string) {
  return key === "activation" ? "/teach/activate"
    : key === "signIn" ? "/login"
    : ["configuration", "permission", "request"].includes(key) ? "/support"
    : null;
}

export function TeacherConnectOnboarding({
  onComplete,
  onAvailabilityChange,
}: TeacherConnectOnboardingProps) {
  const { resolvedTheme } = useTheme();
  const { locale, t } = useTranslation();
  const [connect, setConnect] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<ReturnType<typeof connectFailure> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isOpeningHosted, setIsOpeningHosted] = useState(false);
  // Platform hasn't enabled Stripe Connect yet. Distinct from `error` because
  // it's neither the teacher's fault nor retryable here — recreating/retrying
  // just loops 400s. We render a calm "being configured" panel with no retry.
  const [payoutsUnavailable, setPayoutsUnavailable] = useState(false);
  // Latest theme for init() WITHOUT making it an init dependency — re-initing on
  // every toggle would reset the teacher's onboarding progress. The effect below
  // re-skins the live widget instead.
  const themeRef = useRef(resolvedTheme);
  useEffect(() => {
    themeRef.current = resolvedTheme;
  }, [resolvedTheme]);
  // Mesmo motivo para o idioma: sem `locale` a Stripe adivinha pelo navegador e
  // servia o KYC em portugues dentro de uma pagina em ingles. Ref para o init,
  // `update()` abaixo para a troca ao vivo.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // Report platform availability upward via a ref'd callback so the parent's
  // inline arrow doesn't retrigger the effect every render.
  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  useEffect(() => {
    onAvailabilityChangeRef.current = onAvailabilityChange;
  }, [onAvailabilityChange]);
  useEffect(() => {
    onAvailabilityChangeRef.current?.(payoutsUnavailable);
  }, [payoutsUnavailable]);

  useEffect(() => {
    if (!publishableKey) return;

    let cancelled = false;

    async function init() {
      try {
        // Pre-flight the first Account Session secret ourselves. If the PLATFORM
        // hasn't enabled Connect, this throws ONE clean rejection here — before
        // connect-js is constructed — so we show the calm panel without connect-js
        // retrying the fetcher internally and spraying "Uncaught (in promise)" +
        // a burst of 400s into the console. When Connect IS enabled we reuse this
        // secret for the first init, so the happy path costs no extra call.
        const firstSecret = await fetchConnectAccountSessionSecret();

        let reuseFirstSecret = true;
        const instance = await loadConnectAndInitialize({
          publishableKey: publishableKey!,
          fetchClientSecret: async () => {
            if (reuseFirstSecret) {
              reuseFirstSecret = false;
              return firstSecret;
            }
            // Connect asks again only when the session later expires.
            return fetchConnectAccountSessionSecret();
          },
          // Inherit SkillsetMind brand colors (light/dark) so the embedded UI doesn't
          // look like a foreign Stripe widget plopped onto the page.
          appearance: buildConnectAppearance(themeRef.current),
          // Idioma da INTERFACE, nao o do navegador.
          locale: localeRef.current,
        });
        if (!cancelled) {
          setConnect(instance);
        }
      } catch (cause) {
        if (!cancelled) {
          // Platform-config gap (Connect not enabled) is not a browser/privacy
          // problem — show the honest "being configured" panel, not the red
          // fallback that blames cookies and invites an endless retry.
          if (isConnectNotEnabledError(cause)) {
            setPayoutsUnavailable(true);
            return;
          }
          setError(connectFailure(cause, "initialize"));
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // Re-skin (and re-language) the already-running embedded widget when the
  // teacher flips the theme or the interface language, without re-initializing
  // (which would reset their in-progress onboarding).
  useEffect(() => {
    if (!connect) return;
    connect.update({ appearance: buildConnectAppearance(resolvedTheme), locale });
  }, [connect, resolvedTheme, locale]);

  async function openHostedFallback() {
    setError(null);
    setIsOpeningHosted(true);

    try {
      await startTeacherStripeOnboarding();
    } catch (cause) {
      // Connect-not-enabled comes back here too (the hosted link also calls
      // accounts.create). It's a platform gap, not a "try again" — switch to the
      // calm panel rather than telling the teacher to retry a dead path.
      if (isConnectNotEnabledError(cause)) {
        setPayoutsUnavailable(true);
        setIsOpeningHosted(false);
        return;
      }
      // Keep the category and HTTP status for diagnosis, never transport text.
      setError(connectFailure(cause, "hosted"));
      setIsOpeningHosted(false);
    }
  }

  function retryEmbeddedSetup() {
    setConnect(null);
    setError(null);
    setLoadError(null);
    setPayoutsUnavailable(false);
    setRetryKey((current) => current + 1);
  }

  if (payoutsUnavailable) {
    // Stripe Connect isn't enabled on the platform yet. Nothing the teacher does
    // here can fix it, so we DON'T offer the embedded/hosted buttons (they'd just
    // loop 400s). A single low-key "Check again" re-runs setup once the platform
    // owner has enabled Connect in the Stripe Dashboard.
    return (
      <Card tone="soft" padding="none" className="p-5">
        <Eyebrow tone="muted">{t("connectOnboarding.setup")}</Eyebrow>
        <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
          {t("connectOnboarding.unavailableTitle")}
        </h4>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("connectOnboarding.unavailableBody")}
          <strong className="text-[var(--color-ink)]">
            {" "}{t("connectOnboarding.noAccount")}
          </strong>{" "}
          {t("connectOnboarding.whenReady")}
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={retryEmbeddedSetup}>
            {t("connectOnboarding.checkAgain")}
          </Button>
        </div>
      </Card>
    );
  }

  if (!publishableKey) {
    // No client publishable key in this build, so the embedded component
    // can't initialize. Instead of a dead-end "check back soon" message,
    // offer Stripe's hosted onboarding — it only needs the server secret
    // (already configured) and redirects back to SkillsetMind when done. This
    // keeps payout setup reachable even if the publishable key is missing.
    return (
      <Card padding="none" className="p-5">
        <Eyebrow>{t("connectOnboarding.setup")}</Eyebrow>
        <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
          {t("connectOnboarding.hostedTitle")}
        </h4>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("connectOnboarding.hostedBody")}
        </p>
        {error ? (
          <InlineAlert tone="error" className="mt-3">
            {t(`connectOnboarding.error.${error.key}`)}
            {error.status ? <> {t("activationCheckout.reference")} HTTP {error.status}</> : null}
            {connectRecoveryHref(error.key) ? <Link className="ml-2 underline" href={connectRecoveryHref(error.key)!}>
              {t(`connectOnboarding.recovery.${error.key}`)}
            </Link> : null}
          </InlineAlert>
        ) : null}
        <div className="mt-4">
          <Button onClick={openHostedFallback} disabled={isOpeningHosted}>
            {t(isOpeningHosted ? "connectOnboarding.opening" : "connectOnboarding.continue")}
          </Button>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <StripeConnectFallback
        errorKey={error.key}
        status={error.status}
        isOpeningHosted={isOpeningHosted}
        onHosted={openHostedFallback}
        onRetry={retryEmbeddedSetup}
      />
    );
  }

  if (loadError) {
    return (
      <StripeConnectFallback
        errorKey={loadError}
        isOpeningHosted={isOpeningHosted}
        onHosted={openHostedFallback}
        onRetry={retryEmbeddedSetup}
      />
    );
  }

  if (!connect) {
    return (
      // Card não repassa atributos ARIA, e aqui o aria-busy/aria-live é o
      // ponto: sai como <div> com as mesmas variáveis do primitivo.
      <div
        className="rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5 text-sm text-[var(--color-ink-soft)]"
        aria-busy="true"
        aria-live="polite"
      >
        {t("connectOnboarding.preparing")}
      </div>
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <ConnectComponentsProvider connectInstance={connect}>
        <div className="p-4">
          <ConnectAccountOnboarding
            onExit={() => {
              onComplete?.();
            }}
            onLoadError={(nextError) => {
              const type = nextError.error.type;
              setLoadError(type === "authentication_error" ? "authentication"
                : type === "account_session_create_error" ? "session"
                : type === "api_connection_error" ? "connection"
                : type === "invalid_request_error" ? "request"
                : type === "rate_limit_error" ? "rateLimit"
                : type === "render_error" ? "render"
                : "embedded");
            }}
          />
        </div>
        <p className="border-t fine-rule px-4 py-2 text-[11px] leading-5 text-[var(--color-ink-muted)]">
          {t("connectOnboarding.footer")}
        </p>
      </ConnectComponentsProvider>
    </Card>
  );
}

function StripeConnectFallback({
  errorKey,
  status,
  isOpeningHosted,
  onHosted,
  onRetry,
}: {
  errorKey: string;
  status?: number;
  isOpeningHosted: boolean;
  onHosted: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const recoveryHref = connectRecoveryHref(errorKey);
  return (
    <div className="rounded-[14px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.04)] p-5">
      <Eyebrow>{t("connectOnboarding.fallbackEyebrow")}</Eyebrow>
      <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
        {t("connectOnboarding.fallbackTitle")}
      </h4>
      <p role="alert" className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
        {t(`connectOnboarding.error.${errorKey}`)}{" "}
        {t("connectOnboarding.fallbackBody")}
      </p>
      {status ? <p className="mt-2 text-xs">{t("activationCheckout.reference")} HTTP {status}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* Stripe's hosted page stays available for every error, as before
            translation; the recovery link is an extra way out, not a replacement. */}
        <Button onClick={onHosted} disabled={isOpeningHosted}>
          {t(isOpeningHosted ? "connectOnboarding.opening" : "connectOnboarding.continueSecure")}
        </Button>
        <Button variant="outline" onClick={onRetry}>
          {t("connectOnboarding.retry")}
        </Button>
        {recoveryHref ? <Link className="button-outline px-4 py-2.5 text-sm" href={recoveryHref}>
          {t(`connectOnboarding.recovery.${errorKey}`)}
        </Link> : null}
      </div>
    </div>
  );
}

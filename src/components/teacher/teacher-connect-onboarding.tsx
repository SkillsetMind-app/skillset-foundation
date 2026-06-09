"use client";

import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  loadConnectAndInitialize,
  type LoadError,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import { useEffect, useRef, useState } from "react";

import {
  fetchConnectAccountSessionSecret,
  isConnectNotEnabledError,
  startTeacherStripeOnboarding,
} from "@/lib/payments/connect";
import { useTheme } from "@/lib/theme/theme-provider";

/**
 * Renders Stripe's embedded creator-onboarding flow INSIDE Skillset.
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
 *      own form, validation, and step navigation — Skillset just owns
 *      the host page.
 *
 * onExit fires when the creator finishes (or escapes) onboarding. We
 * fire onComplete so the parent (TeacherWalletPanel) can refresh status.
 */

const publishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

/**
 * Stripe's Appearance API runs inside an iframe and can't read Skillset's CSS
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
};

export function TeacherConnectOnboarding({
  onComplete,
}: TeacherConnectOnboardingProps) {
  const { resolvedTheme } = useTheme();
  const [connect, setConnect] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError["error"] | null>(null);
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
          // Inherit Skillset brand colors (light/dark) so the embedded UI doesn't
          // look like a foreign Stripe widget plopped onto the page.
          appearance: buildConnectAppearance(themeRef.current),
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
          const message =
            cause instanceof Error
              ? cause.message
              : "Stripe Connect failed to initialize.";
          setError(message);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // Re-skin the already-running embedded widget when the teacher flips the theme,
  // without re-initializing (which would reset their in-progress onboarding).
  useEffect(() => {
    if (!connect) return;
    connect.update({ appearance: buildConnectAppearance(resolvedTheme) });
  }, [connect, resolvedTheme]);

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
      // Surface the underlying reason instead of a mute "try again". The
      // callable throws a FirebaseError whose message carries the server-side
      // HttpsError detail — e.g. "Stripe secret key is not configured." when
      // the STRIPE_SECRET_KEY secret is unset, or a permission error when the
      // account lacks the teacher role. A silent catch made payout-setup
      // failures undiagnosable (they looked like a dead button).
      const detail = cause instanceof Error ? cause.message.trim() : "";
      setError(
        detail
          ? `We could not open Stripe onboarding: ${detail}`
          : "We could not open Stripe onboarding. Please try again.",
      );
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
      <div className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          Payout setup
        </p>
        <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
          Payouts are being configured.
        </h4>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          Skillset is finishing its secure payout setup with Stripe. This is on
          our side, not yours — no action is needed. You&apos;ll be able to
          connect a payout account and sell paid courses as soon as it&apos;s
          ready, usually within a day.
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={retryEmbeddedSetup}
            className="button-outline px-4 py-2 text-sm"
          >
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (!publishableKey) {
    // No client publishable key in this build, so the embedded component
    // can't initialize. Instead of a dead-end "check back soon" message,
    // offer Stripe's hosted onboarding — it only needs the server secret
    // (already configured) and redirects back to Skillset when done. This
    // keeps payout setup reachable even if the publishable key is missing.
    return (
      <div className="rounded-[14px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Payout setup
        </p>
        <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
          Set up payouts with Stripe.
        </h4>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          Connect a payout account to start selling paid courses. Stripe
          verifies your identity and bank details on a secure page and returns
          you to Skillset the moment you finish.
        </p>
        {error ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}
        <div className="mt-4">
          <button
            type="button"
            onClick={openHostedFallback}
            disabled={isOpeningHosted}
            className="button-solid px-4 py-2 text-sm disabled:opacity-60"
          >
            {isOpeningHosted ? "Opening Stripe..." : "Continue with Stripe"}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <StripeConnectFallback
        detail={error}
        isOpeningHosted={isOpeningHosted}
        onHosted={openHostedFallback}
        onRetry={retryEmbeddedSetup}
      />
    );
  }

  if (loadError) {
    return (
      <StripeConnectFallback
        detail={
          loadError.type === "authentication_error"
            ? "Stripe could not complete the embedded authentication flow in this browser session."
            : loadError.message || `Stripe embedded component error: ${loadError.type}.`
        }
        isOpeningHosted={isOpeningHosted}
        onHosted={openHostedFallback}
        onRetry={retryEmbeddedSetup}
      />
    );
  }

  if (!connect) {
    return (
      <div
        className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-5 text-sm text-[var(--color-ink-soft)]"
        aria-busy="true"
        aria-live="polite"
      >
        Preparing your payout onboarding…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[14px] border fine-rule bg-white shadow-[var(--shadow-soft)]">
      <ConnectComponentsProvider connectInstance={connect}>
        <div className="p-4">
          <ConnectAccountOnboarding
            onExit={() => {
              onComplete?.();
            }}
            onLoadError={(nextError) => {
              setLoadError(nextError.error);
            }}
          />
        </div>
        <p className="border-t fine-rule px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          Powered by Stripe
        </p>
      </ConnectComponentsProvider>
    </div>
  );
}

function StripeConnectFallback({
  detail,
  isOpeningHosted,
  onHosted,
  onRetry,
}: {
  detail: string;
  isOpeningHosted: boolean;
  onHosted: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.04)] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        Stripe embedded setup needs a fallback
      </p>
      <h4 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
        Continue with Stripe&apos;s secure onboarding page.
      </h4>
      <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail} This can happen with browser privacy settings, blocked cookies,
        or when Stripe requires a stronger authentication step. The payout setup
        still works; this fallback returns you to Skillset after completion.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onHosted}
          disabled={isOpeningHosted}
          className="button-solid px-4 py-2 text-sm disabled:opacity-60"
        >
          {isOpeningHosted ? "Opening Stripe..." : "Continue secure setup"}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="button-outline px-4 py-2 text-sm"
        >
          Retry embedded setup
        </button>
      </div>
    </div>
  );
}

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
import { useEffect, useState } from "react";

import {
  fetchConnectAccountSessionSecret,
  startTeacherStripeOnboarding,
} from "@/lib/payments/connect";

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

type TeacherConnectOnboardingProps = {
  onComplete?: () => void;
};

export function TeacherConnectOnboarding({
  onComplete,
}: TeacherConnectOnboardingProps) {
  const [connect, setConnect] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError["error"] | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isOpeningHosted, setIsOpeningHosted] = useState(false);

  useEffect(() => {
    if (!publishableKey) return;

    let cancelled = false;

    async function init() {
      try {
        const instance = await loadConnectAndInitialize({
          publishableKey: publishableKey!,
          fetchClientSecret: fetchConnectAccountSessionSecret,
          // Inherit Skillset brand colors so the embedded UI doesn't
          // look like a foreign Stripe widget plopped onto the page.
          appearance: {
            overlays: "dialog",
            variables: {
              colorPrimary: "#1a365d",
              colorBackground: "#ffffff",
              colorText: "#0f2744",
              colorDanger: "#b22234",
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
              borderRadius: "10px",
            },
          },
        });
        if (!cancelled) {
          setConnect(instance);
        }
      } catch (cause) {
        if (!cancelled) {
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

  async function openHostedFallback() {
    setError(null);
    setIsOpeningHosted(true);

    try {
      await startTeacherStripeOnboarding();
    } catch {
      setError("We could not open Stripe onboarding. Please try again.");
      setIsOpeningHosted(false);
    }
  }

  function retryEmbeddedSetup() {
    setConnect(null);
    setError(null);
    setLoadError(null);
    setRetryKey((current) => current + 1);
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

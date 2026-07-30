"use client";

import Link from "next/link";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useState } from "react";

import { BrandName } from "@/components/shared/brand-name";
import { activationFeeUsd, plans } from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { createActivationCheckoutClientSecret } from "@/lib/payments/activation";
import { track } from "@/lib/posthog/events";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

// Module-scope loader so remounts reuse one Stripe instance. Deliberately not
// shared with the billing panel's copy: extracting it would mean editing a
// working checkout flow for no user-visible gain.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  if (!publishableKey) return null;
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

/**
 * Embedded Stripe Checkout for the one-time storefront activation fee.
 *
 * Every terminal state ships a way out — a creator blocked here is a creator
 * who cannot publish at all, so a dead end would be the worst possible place
 * to strand one.
 */
export function ActivationCheckoutPanel() {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripeLoader = getStripePromise();

  const freeCommission =
    plans.find((plan) => plan.id === "free")?.commissionPercent ?? 10;

  // Stable options object — recreating it every render reboots the provider and
  // the creator loses any half-typed card.
  const options = useMemo(
    () => (clientSecret ? { clientSecret } : null),
    [clientSecret],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!stripeLoader) return;
      setError(null);
      setClientSecret(null);

      track.checkoutStarted({
        course_id: "activation_fee",
        price_minor: activationFeeUsd * 100,
        currency: "USD",
      });

      try {
        const result = await createActivationCheckoutClientSecret();
        if (!cancelled) setClientSecret(result.clientSecret);
      } catch (cause) {
        if (!cancelled) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Could not start checkout. Try again in a moment.";
          setError(message);
          track.checkoutFailed({
            course_id: "activation_fee",
            reason: message,
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [stripeLoader]);

  if (!publishableKey) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink)]">
        <p className="font-semibold">Card checkout isn&apos;t available here yet.</p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          We can activate your storefront manually in the meantime — contact us
          and we&apos;ll switch it on for your account.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/teach" className="button-solid px-4 py-2 text-sm">
            Back to studio
          </Link>
          <Link href="/support" className="button-outline px-4 py-2 text-sm">
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-[14px] border fine-rule bg-white shadow-[var(--shadow-soft)]">
        {error ? (
          <div className="p-6 text-sm text-[var(--color-accent-fg)]">
            <p className="font-semibold">Checkout could not start.</p>
            <p className="mt-2 text-[var(--color-ink-soft)]">{error}</p>
            <Link
              href="/teach"
              className="button-outline mt-4 px-4 py-2 text-sm text-[var(--color-ink)]"
            >
              Back to studio
            </Link>
          </div>
        ) : !options ? (
          <div
            className="grid place-items-center p-8 text-sm text-[var(--color-ink-soft)]"
            aria-busy="true"
            aria-live="polite"
          >
            Preparing secure checkout…
          </div>
        ) : (
          <EmbeddedCheckoutProvider stripe={stripeLoader!} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>

      <aside className="h-fit rounded-[14px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          You&apos;re activating
        </p>
        <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
          Your <BrandName /> storefront
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Unlocks publishing. Paid once — never again.
        </p>
        <div className="mt-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            One-time fee
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="display-title text-3xl tabular-nums text-[var(--color-primary)]">
              {formatUsdWhole(activationFeeUsd)}
            </span>
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              once
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-soft)]">
            No monthly subscription on Free
          </p>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-[var(--color-ink-muted)]">
          After this, the Free plan still costs nothing per month and takes{" "}
          <strong className="text-[var(--color-ink)]">{freeCommission}%</strong>{" "}
          per sale. Stripe processing fee is passed through to you on every sale
          (2.9% + $0.30 USD / 5.4% + $0.30 estimated non-USD).
        </p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          Powered by Stripe
        </p>
      </aside>
    </div>
  );
}

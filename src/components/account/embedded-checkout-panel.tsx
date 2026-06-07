"use client";

import Link from "next/link";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { plans, type PlanBillingCycle, type PlanId } from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { createBillingCheckoutClientSecret } from "@/lib/payments/billing";
import { track } from "@/lib/posthog/events";

/**
 * The publishable key is intentionally public — Stripe distinguishes
 * publishable (front-end safe) from secret (server-only). It still has
 * to be exposed via NEXT_PUBLIC_* so Next inlines it at build time.
 * When missing, the panel surfaces a clear "billing not configured"
 * banner instead of trying to call Stripe with `undefined`.
 */
const publishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

// Stripe.js loader is cached at module scope so multiple checkouts
// reuse the same Stripe instance instead of re-loading the SDK.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  if (!publishableKey) return null;
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

/**
 * Terminal-state notice for the plan checkout that ALWAYS offers a way
 * out. The rest of the app never strands a user in a dead state (every
 * *State component ships forward links); the billing panel must match —
 * otherwise a missing publishable key or unknown plan leaves the user
 * with nowhere to go.
 */
function BillingUnavailableNotice({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[4px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink)]">
      <p className="font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-2 text-[var(--color-ink-soft)]">{detail}</p>
      {children}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/account/plans" className="button-solid px-4 py-2 text-sm">
          Back to plans
        </Link>
        <Link href="/support" className="button-outline px-4 py-2 text-sm">
          Contact support
        </Link>
      </div>
    </div>
  );
}

type EmbeddedCheckoutPanelProps = {
  planId: Exclude<PlanId, "free">;
  cycle: PlanBillingCycle;
};

export function EmbeddedCheckoutPanel({
  planId,
  cycle,
}: EmbeddedCheckoutPanelProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripeLoader = getStripePromise();
  const plan = plans.find((candidate) => candidate.id === planId);

  // Stable options object — recreating it every render reboots the
  // EmbeddedCheckoutProvider and the user loses any half-typed card.
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

      // CHECKOUT_STARTED — fires once the panel commits to opening Stripe.
      // course_id is reused for plan_id (the events taxonomy treats both as
      // commerce intents); price is sent in minor units to keep the schema
      // consistent with order/checkout completion events.
      const planMeta = plans.find((p) => p.id === planId);
      const priceUsd =
        cycle === "yearly"
          ? planMeta?.yearlyUsd ?? 0
          : planMeta?.monthlyUsd ?? 0;
      track.checkoutStarted({
        course_id: `plan:${planId}:${cycle}`,
        price_minor: Math.round(priceUsd * 100),
        currency: "USD",
      });

      try {
        const result = await createBillingCheckoutClientSecret(planId, cycle);
        if (!cancelled) {
          setClientSecret(result.clientSecret);
        }
      } catch (cause) {
        if (!cancelled) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Could not start checkout. Try again in a moment.";
          setError(message);
          // CHECKOUT_FAILED — only fired in the catch path so PostHog
          // funnel stays clean (no false negatives on stripe-side errors
          // that surface via Stripe Elements directly).
          track.checkoutFailed({
            course_id: `plan:${planId}:${cycle}`,
            reason: message,
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [planId, cycle, stripeLoader]);

  if (!plan) {
    return (
      <BillingUnavailableNotice
        title="We couldn't find that plan."
        detail={`The "${planId}" plan isn't available for purchase. Head back to plans to choose a current tier.`}
      />
    );
  }

  if (!publishableKey) {
    return (
      <BillingUnavailableNotice
        title="Card checkout isn't available here yet."
        detail="Card payments for plan upgrades aren't available on this account just yet. Your current plan keeps working — head back to plans, or contact us and we'll switch it on."
      />
    );
  }

  const isYearly = cycle === "yearly";
  // Lead with the monthly figure (annualized in yearly mode) to match the
  // plans grid; the exact billed total sits just below it.
  const monthlyFigure = isYearly ? plan.yearlyUsd / 12 : plan.monthlyUsd;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-[4px] border fine-rule bg-white shadow-[var(--shadow-soft)]">
        {error ? (
          <div className="p-6 text-sm text-[var(--color-accent-fg)]">
            <p className="font-semibold">Checkout could not start.</p>
            <p className="mt-2 text-[var(--color-ink-soft)]">{error}</p>
            <Link
              href="/account/plans"
              className="button-outline mt-4 px-4 py-2 text-sm text-[var(--color-ink)]"
            >
              Back to plans
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

      <aside className="h-fit rounded-[4px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          You&apos;re subscribing to
        </p>
        <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
          Skillset {plan.name}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {plan.tagline}
        </p>
        <div className="mt-4 rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            {isYearly ? "Yearly billing" : "Monthly billing"}
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="display-title text-3xl tabular-nums text-[var(--color-primary)]">
              {formatUsdWhole(Math.round(monthlyFigure))}
            </span>
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              /mo
            </span>
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-[var(--color-ink-soft)]">
            {isYearly
              ? `Billed ${formatUsdWhole(plan.yearlyUsd)} yearly`
              : `Billed ${formatUsdWhole(plan.monthlyUsd)} monthly`}
          </p>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-[var(--color-ink-muted)]">
          Commission per sale on {plan.name}:{" "}
          <strong className="text-[var(--color-ink)]">
            {plan.commissionPercent}%
          </strong>
          . Stripe processing fee is passed through to you on every sale
          (2.9% + $0.30 USD / 5.4% + $0.30 estimated non-USD).
        </p>
        <p className="mt-2 text-[11px] leading-5 text-[var(--color-ink-muted)]">
          Cancel anytime from your billing settings — you keep your plan
          benefits until the end of the period.
        </p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          Powered by Stripe
        </p>
      </aside>
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { BrandName } from "@/components/shared/brand-name";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StripeFrameSkeleton } from "@/components/teacher/builder-skeleton";
import { SupportDetails } from "@/components/teacher/support-details";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { Locale } from "@/lib/i18n/config";
import {
  formatPlanCommission,
  publicPlans,
  type PlanBillingCycle,
  type PlanId,
} from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { createBillingCheckoutClientSecret } from "@/lib/payments/billing";
import { planDisclosure } from "@/lib/payments/plan-disclosure";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
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
const stripePromises: Partial<Record<Locale, Promise<Stripe | null>>> = {};
function getStripePromise(locale: Locale): Promise<Stripe | null> | null {
  if (!publishableKey) return null;
  return stripePromises[locale] ??= loadStripe(publishableKey, { locale });
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
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink)]">
      <p className="font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-2 text-[var(--color-ink-soft)]">{detail}</p>
      {children}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/account/plans" className="button-solid px-4 py-2 text-sm">
          {t("billingCheckout.backToPlans")}
        </Link>
        <Link href="/support" className="button-outline px-4 py-2 text-sm">
          {t("activationCheckout.support")}
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
  const { t, locale } = useTranslation();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; status?: number } | null>(null);
  // Whether this checkout opens a trial is the server's call (one per
  // account); the terms beside the card form follow its answer.
  const [trialDays, setTrialDays] = useState<number | null>(null);
  // No live locale setter in Embedded Checkout: preserve Stripe and card input
  // for this mount, while the surrounding copy follows the current language.
  const [stripeLoader] = useState(() => getStripePromise(locale));
  // Only plans on offer: a link to Enterprise or Free lands on "unknown plan".
  const plan = publicPlans.find((candidate) => candidate.id === planId);

  // Stable options object — recreating it every render reboots the
  // EmbeddedCheckoutProvider and the user loses any half-typed card.
  const options = useMemo(
    () => (clientSecret ? { clientSecret } : null),
    [clientSecret],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // A plan that is not on offer (Enterprise, Free, a typo) never reaches
      // the server: the panel shows "unknown plan" below.
      if (!stripeLoader || !publicPlans.some((candidate) => candidate.id === planId)) return;
      setError(null);
      setClientSecret(null);

      // CHECKOUT_STARTED — fires once the panel commits to opening Stripe.
      // course_id is reused for plan_id (the events taxonomy treats both as
      // commerce intents); price is sent in minor units to keep the schema
      // consistent with order/checkout completion events.
      const planMeta = publicPlans.find((p) => p.id === planId);
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
          setTrialDays(result.trialDays ?? 0);
        }
      } catch (cause) {
        if (!cancelled) {
          const paymentError = cause instanceof PaymentRequestError ? cause : null;
          const key = paymentError?.code === "payments_not_configured" ? "notConfigured"
            : paymentError?.code === "unauthenticated" || paymentError?.status === 401 ? "signIn"
            : paymentError?.code === "permission_denied" || paymentError?.status === 403 ? "permission"
            : paymentError?.status === 409 ? "conflict"
            : paymentError?.status === 429 ? "rateLimit" : "generic";
          setError({ key, status: paymentError?.status });
          // CHECKOUT_FAILED — only fired in the catch path so PostHog
          // funnel stays clean (no false negatives on stripe-side errors
          // that surface via Stripe Elements directly).
          track.checkoutFailed({
            course_id: `plan:${planId}:${cycle}`,
            // Analytics keeps the pre-translation reason; only the UI moved to keys.
            reason: cause instanceof Error
              ? cause.message
              : "Could not start checkout. Try again in a moment.",
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
        title={t("billingCheckout.unknownPlanTitle")}
        detail={t("billingCheckout.unknownPlanBody").replace("{plan}", () => planId)}
      />
    );
  }

  if (!publishableKey) {
    return (
      <BillingUnavailableNotice
        title={t("activationCheckout.unavailableTitle")}
        detail={t("billingCheckout.unavailableBody")}
      />
    );
  }

  const isYearly = cycle === "yearly";
  // Lead with the monthly figure (annualized in yearly mode) to match the
  // plans grid; the exact billed total sits just below it.
  const monthlyFigure = isYearly ? plan.yearlyUsd / 12 : plan.monthlyUsd;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)]">
        {error ? (
          <div className="p-6 text-sm">
            {/* The app's standard error notice (icon, theme-aware background, read
                aloud); it was a loose red title, with no box. */}
            <InlineAlert tone="error" title={t("activationCheckout.errorTitle")}>
              <p className="mt-1 font-normal">{t(`billingCheckout.error.${error.key}`)}</p>
              {/* The sentence above says what to do; the response code stays only
                  for support, collapsed (it was "Reference: HTTP 409"). */}
              {error.status ? <SupportDetails code={error.status} className="mt-2" /> : null}
            </InlineAlert>
            <Link
              href="/account/plans"
              className="button-outline mt-4 px-4 py-2 text-sm text-[var(--color-ink)]"
            >
              {t("billingCheckout.backToPlans")}
            </Link>
          </div>
        ) : !options ? (
          <StripeFrameSkeleton label={t("activationCheckout.preparing")} />
        ) : (
          <EmbeddedCheckoutProvider stripe={stripeLoader!} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>

      {/* Below 1024px the grid becomes one column: the summary (what is being bought,
          price, free trial and renewal) comes before the Stripe card, not
          after the pay button. On desktop it sits in the right column. */}
      <aside className="order-first h-fit rounded-lg border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] lg:order-none">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("billingCheckout.subscribing")}
        </p>
        <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
          <BrandName /> {plan.name}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t(`publicPages.plans.${plan.id}.tagline`)}
        </p>
        <div className="mt-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            {t(isYearly ? "billingCheckout.yearly" : "billingCheckout.monthly")}
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="display-title text-3xl tabular-nums text-[var(--color-primary)]">
              {formatUsdWhole(Math.round(monthlyFigure), locale)}
            </span>
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              {t("billingCheckout.perMonth")}
            </span>
          </div>
          <p className="mt-1 text-xs tabular-nums text-[var(--color-ink-soft)]">
            {t(isYearly ? "billingCheckout.billedYearly" : "billingCheckout.billedMonthly")
              .replace("{amount}", () => formatUsdWhole(isYearly ? plan.yearlyUsd : plan.monthlyUsd, locale))}
          </p>
        </div>
        {/* Small print in the summary at 12px (was 11px; the Stripe badge, 10px):
            it is the subscription text, read on a phone by people 55+. */}
        <p className="mt-4 text-xs leading-5 text-[var(--color-ink-muted)]">
          {t("billingCheckout.commission").replace("{plan}", () => plan.name)}{" "}
          <strong className="text-[var(--color-ink)]">
            {formatPlanCommission(plan)}
          </strong>
          {t("billingCheckout.processing")}
        </p>
        {/* The renewal sentence arrives together with the server response: its
            place is reserved (four lines) in the meantime, so the summary does
            not grow and push the card when it appears. Measured in the site font
            at 12px/20px: with a free trial, 3 to 4 lines in English and 4
            in Spanish at phone widths; three lines let it jump. */}
        {error ? null : (
          <p className="mt-2 min-h-[5rem] text-xs font-semibold leading-5 text-[var(--color-ink)]">
            {trialDays !== null ? (
              planDisclosure({ t, locale, plan, cycle, trial: trialDays > 0 })
            ) : (
              <span aria-hidden="true" className="block animate-pulse space-y-2 pt-1">
                <span className="block h-3 rounded-sm bg-[var(--color-surface-strong)]" />
                <span className="block h-3 w-2/3 rounded-sm bg-[var(--color-surface-strong)]" />
              </span>
            )}
          </p>
        )}
        <p className="mt-2 text-xs leading-5 text-[var(--color-ink-muted)]">
          {t("billingCheckout.cancel")}
        </p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          {t("activationCheckout.poweredBy")}
        </p>
      </aside>
    </div>
  );
}

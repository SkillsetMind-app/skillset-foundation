"use client";

import Link from "next/link";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { BrandName } from "@/components/shared/brand-name";
import { Card, Eyebrow, buttonClasses } from "@/components/ui";
import { activationFeeUsd, plans } from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { createActivationCheckoutClientSecret } from "@/lib/payments/activation";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import type { Locale } from "@/lib/i18n/config";
import { track } from "@/lib/posthog/events";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;

// Module-scope loader so remounts reuse one Stripe instance. Deliberately not
// shared with the billing panel's copy: extracting it would mean editing a
// working checkout flow for no user-visible gain.
const stripePromises: Partial<Record<Locale, Promise<Stripe | null>>> = {};
function getStripePromise(locale: Locale): Promise<Stripe | null> | null {
  if (!publishableKey) return null;
  return stripePromises[locale] ??= loadStripe(publishableKey, { locale });
}

/**
 * Embedded Stripe Checkout for the one-time storefront activation fee.
 *
 * Every terminal state ships a way out — a creator blocked here is a creator
 * who cannot publish at all, so a dead end would be the worst possible place
 * to strand one.
 */
export function ActivationCheckoutPanel() {
  const { t, locale } = useTranslation();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<{
    key: string;
    status?: number;
    verificationRequired: boolean;
  } | null>(null);
  // Embedded Checkout has no live locale update. Freeze the loader for this
  // mount: changing language must not replace Stripe or lose entered card data.
  const [stripeLoader] = useState(() => getStripePromise(locale));

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
          const paymentError = cause instanceof PaymentRequestError ? cause : null;
          const code = paymentError?.code;
          const key = code === "activation_not_required" ? "notRequired"
            : code === "payments_not_configured" ? "notConfigured"
            : code === "permission_denied" || paymentError?.status === 403 ? "permission"
            : code === "unauthenticated" || paymentError?.status === 401 ? "signIn"
            : paymentError?.status === 429 ? "rateLimit"
            : paymentError?.status === 409 ? "conflict"
            : "generic";
          setError({
            key,
            status: paymentError?.status,
            verificationRequired: cause instanceof PaymentRequestError
              && cause.code === "creator_verification_required",
          });
          track.checkoutFailed({
            course_id: "activation_fee",
            reason: code === "creator_verification_required"
              ? "creator_verification_required" : `activation_checkout_${key}`,
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
        <p className="font-semibold">{t("activationCheckout.unavailableTitle")}</p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          {t("activationCheckout.unavailableBody")}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/teach/builder" className={buttonClasses()}>
            {t("activationCheckout.backToStudio")}
          </Link>
          <Link href="/support" className={buttonClasses({ variant: "outline" })}>
            {t("activationCheckout.support")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card padding="none" className="overflow-hidden">
        {error ? (
          <div role="alert" className="p-6 text-sm text-[var(--color-accent-fg)]">
            <p className="font-semibold">
              {error.verificationRequired
                ? t("creatorPanel.activationGate.verificationTitle")
                : t("activationCheckout.errorTitle")}
            </p>
            <p className="mt-2 text-[var(--color-ink-soft)]">
              {error.verificationRequired
                ? t("creatorPanel.activationGate.verificationBody")
                : t(`activationCheckout.error.${error.key}`)}
            </p>
            {error.status ? <p className="mt-2 text-xs">{t("activationCheckout.reference")} HTTP {error.status}</p> : null}
            <Link href={error.verificationRequired ? "/teach/verification" : "/teach/builder"} className={buttonClasses({ variant: "outline" }, "mt-4")}>
              {error.verificationRequired
                ? t("creatorPanel.activationGate.verificationAction")
                : t("activationCheckout.backToStudio")}
            </Link>
          </div>
        ) : !options ? (
          <div
            className="grid place-items-center p-8 text-sm text-[var(--color-ink-soft)]"
            aria-busy="true"
            aria-live="polite"
          >
            {t("activationCheckout.preparing")}
          </div>
        ) : (
          <EmbeddedCheckoutProvider stripe={stripeLoader!} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </Card>

      <Card as="aside" padding="none" className="h-fit p-5">
        <Eyebrow>{t("activationCheckout.activating")}</Eyebrow>
        <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
          {t("activationCheckout.storefrontBefore")}<BrandName />{t("activationCheckout.storefrontAfter")}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t("activationCheckout.unlocks")}
        </p>
        <Card tone="soft" padding="sm" shadow={false} className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            {t("activationCheckout.oneTimeFee")}
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="display-title text-3xl tabular-nums text-[var(--color-primary)]">
              {formatUsdWhole(activationFeeUsd)}
            </span>
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              {t("activationCheckout.once")}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-soft)]">
            {t("activationCheckout.noSubscription")}
          </p>
        </Card>
        <p className="mt-4 text-[11px] leading-5 text-[var(--color-ink-muted)]">
          {t("activationCheckout.commissionBefore")}{" "}
          <strong className="text-[var(--color-ink)]">{freeCommission}%</strong>{" "}
          {t("activationCheckout.commissionAfter")}
        </p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          {t("activationCheckout.poweredBy")}
        </p>
      </Card>
    </div>
  );
}

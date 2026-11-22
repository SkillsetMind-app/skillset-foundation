"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, Info } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { buttonClasses } from "@/components/ui/button";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
import { fetchPlanBillingState, type PlanSubscriptionView } from "@/lib/payments/billing";
import { formatTrialDate } from "@/lib/payments/plan-disclosure";

// Quem acabou de dar o cartao chegava a "Review your subscription status." e
// a um unico botao "Back to billing": nada dizia que o teste gratis comecou
// nem levava de volta ao estudio. A tela agora pergunta ao servidor (a mesma
// leitura da pagina de Billing, alimentada pelo webhook da Stripe) e confirma.
// A referencia na URL continua sem provar nada: quem confirma e a assinatura.
const POLL_MS = 3000;
// ~45 s. O webhook costuma chegar em poucos segundos; passou disso, a tela
// volta ao texto antigo ("confira em Billing") em vez de girar para sempre.
const MAX_TRIES = 15;

export function BillingReturnStatus() {
  const { t, locale } = useTranslation();
  const [subscription, setSubscription] = useState<PlanSubscriptionView | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      tries += 1;
      try {
        const state = await fetchPlanBillingState();
        if (cancelled) return;
        const status = state.subscription?.status;
        if (state.subscription && (status === "trialing" || status === "active")) {
          setSubscription(state.subscription);
          return;
        }
      } catch {
        // Leitura falhou (rede, sessao): tenta de novo ate o limite.
      }
      if (cancelled) return;
      if (tries >= MAX_TRIES) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(check, POLL_MS);
    }

    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const actions = (primary: boolean) => (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Link
        href="/teach"
        className={buttonClasses({ variant: primary ? "solid" : "outline", size: primary ? "lg" : "md" })}
      >
        {t("billingCheckout.openStudio")}
      </Link>
      <Link href="/account/billing?tab=overview" className={buttonClasses({ variant: "outline", size: primary ? "lg" : "md" })}>
        {t("billingCheckout.backToBilling")}
      </Link>
    </div>
  );

  if (subscription) {
    const trialing = subscription.status === "trialing" && Boolean(subscription.trialEnd);
    return (
      <div className="px-4 py-8 text-center" role="status">
        <div className="mx-auto grid size-12 place-items-center text-[var(--color-success-fg)]">
          <CircleCheck aria-hidden="true" size={28} />
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-[var(--color-primary)]">
          {trialing
            ? t("billingCheckout.trialStarted").replace("{days}", () => String(PLAN_TRIAL_DAYS))
            : t("billingCheckout.planActive")}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          {trialing && subscription.trialEnd
            ? t("billingCheckout.trialStartedBody").replace("{date}", () =>
                formatTrialDate(new Date(subscription.trialEnd as string), locale))
            : t("billingCheckout.planActiveBody")}
        </p>
        {actions(true)}
      </div>
    );
  }

  if (gaveUp) {
    return (
      <div className="px-4 py-8 text-center">
        <div className="mx-auto grid size-12 place-items-center text-[var(--color-ink-soft)]">
          <Info aria-hidden="true" size={24} />
        </div>
        <h2 className="mt-3 text-2xl font-semibold text-[var(--color-primary)]">
          {t("billingCheckout.returnHeading")}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("billingCheckout.returnBody")}
        </p>
        {actions(false)}
      </div>
    );
  }

  return (
    <div className="px-4 py-8 text-center" role="status" aria-live="polite">
      <div className="mx-auto size-12 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin" />
      <h2 className="mt-4 text-2xl font-semibold text-[var(--color-primary)]">
        {t("billingCheckout.confirming")}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("billingCheckout.confirmingBody")}
      </p>
    </div>
  );
}

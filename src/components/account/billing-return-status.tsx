"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, Info } from "lucide-react";

import { PaymentReturnCard } from "@/components/account/payment-return-card";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpinnerRing } from "@/components/shared/skillset-spinner";
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

  // O botao do estudio so existe depois da confirmacao. Esperando ou sem
  // resposta, a saida e Billing (e o suporte, quando a confirmacao nao veio):
  // nada aqui pode parecer confirmado.
  const backToBilling = (variant: "solid" | "outline") => (
    <Link href="/account/billing?tab=overview" className={buttonClasses({ variant })}>
      {t("billingCheckout.backToBilling")}
    </Link>
  );

  const trialing = subscription?.status === "trialing" && Boolean(subscription.trialEnd);
  const confirmed = Boolean(subscription);

  const heading = confirmed
    ? trialing
      ? t("billingCheckout.trialStarted").replace("{days}", () => String(PLAN_TRIAL_DAYS))
      : t("billingCheckout.planActive")
    : gaveUp
      ? t("billingCheckout.returnHeading")
      : t("billingCheckout.confirming");
  const body = confirmed
    ? trialing && subscription?.trialEnd
      ? t("billingCheckout.trialStartedBody").replace("{date}", () =>
          formatTrialDate(new Date(subscription.trialEnd as string), locale))
      : t("billingCheckout.planActiveBody")
    : gaveUp
      ? t("billingCheckout.returnBody")
      : t("billingCheckout.confirmingBody");

  // A regiao viva e uma so nos tres estados (mora no cartao): trocar o
  // elemento a cada estado fazia o anuncio do resultado se perder.
  return (
    <PaymentReturnCard
      icon={confirmed ? (
        <CircleCheck aria-hidden="true" size={20} className="text-[var(--color-success-fg)]" />
      ) : gaveUp ? (
        <Info aria-hidden="true" size={20} />
      ) : (
        <SpinnerRing size="sm" />
      )}
      heading={heading}
      body={body}
      actions={confirmed ? (
        <>
          <Link href="/teach" className={buttonClasses({ variant: "solid" })}>
            {t("billingCheckout.openStudio")}
          </Link>
          {backToBilling("outline")}
        </>
      ) : gaveUp ? (
        <>
          {backToBilling("solid")}
          <Link href="/support" className={buttonClasses({ variant: "outline" })}>
            {t("billingCheckout.support")}
          </Link>
        </>
      ) : (
        backToBilling("outline")
      )}
    />
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { UpgradeModal } from "@/components/account/upgrade-modal";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { BusyLabel } from "@/components/ui/busy-label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import {
  formatPlanCommission,
  hasRealStripePriceIds,
  isBillingConfigured,
  plans,
  publicPlans,
  type Plan,
  type PlanBillingCycle,
  type PlanId,
} from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import {
  cancelPlanSubscription,
  fetchPlanBillingState,
  isCheckoutClientConfigured,
  openBillingPortal,
  type PlanBillingState,
} from "@/lib/payments/billing";
import { formatTrialDate, planDisclosure } from "@/lib/payments/plan-disclosure";

type UpgradeState = {
  planId: Exclude<PlanId, "free">;
  cycle: PlanBillingCycle;
} | null;

const billingCycles: readonly PlanBillingCycle[] = ["monthly", "yearly"];

export function PlansPanel() {
  const { t, locale } = useTranslation();
  const formatPrice = (amount: number) => formatUsdWhole(amount, locale);
  const { user } = useAuth();
  const [cycle, setCycle] = useState<PlanBillingCycle>("monthly");
  // null = ainda não sabemos. Assumir "free" antes de carregar fazia um
  // assinante Pro ver "Current plan: Free" com o cartão Free marcado como
  // "Your plan" e nenhum botão Manage — piscando a cada carga, e permanente se
  // o perfil falhasse. Como Manage é o único caminho de cancelamento, o
  // palpite otimista escondia justamente o controle que o assinante procurava.
  const [currentPlanId, setCurrentPlanId] = useState<PlanId | null>(null);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeState>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Trial eligibility and the live subscription. null until loaded, and stays
  // null if the read fails: the cards then show the no-trial terms, and the
  // checkout itself still decides (and discloses) the trial on Stripe's page.
  const [billing, setBilling] = useState<PlanBillingState | null>(null);
  // Keyed on the uid, not the user object: a re-fetch on every new object
  // would overwrite the state "Cancel plan" just wrote.
  const uid = user?.uid ?? null;
  // A assinatura do perfil, para o "Try again" ler o plano de novo sem sair do
  // canal do tempo real; a seção fica nos dois desfechos e recebe o foco.
  const profileRead = useRef<{ reload: () => Promise<void> } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchPlanBillingState()
      .then((state) => {
        if (!cancelled) setBilling(state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!user) return;
    const subscription = subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPlanLoadFailed(false);
        setCurrentPlanId(profile?.currentPlanId ?? "free");
      },
      () => {
        // Falha em carregar o perfil não é evidência de plano gratuito. Marca
        // como desconhecido para a UI não afirmar "Free" a um assinante nem
        // esconder o Manage; os botões de upgrade seguem funcionando.
        setPlanLoadFailed(true);
      },
    );
    profileRead.current = subscription;
    return () => {
      profileRead.current = null;
      subscription();
    };
  }, [user]);

  // Volta ao "Loading..." do plano até a leitura nova responder.
  function retryPlanRead() {
    setPlanLoadFailed(false);
    return profileRead.current?.reload();
  }

  // Two independent gates must both be green for a real upgrade:
  //   1. Price IDs configured server-side (isBillingConfigured)
  //   2. Stripe publishable key inlined client-side (isCheckoutClientConfigured)
  // Splitting them lets the banner explain EXACTLY what's pending, and keeps
  // the upgrade buttons honest instead of clicking into a dead checkout.
  const priceIdsReady = isBillingConfigured();
  const checkoutClientReady = isCheckoutClientConfigured();
  const checkoutReady = priceIdsReady && checkoutClientReady;

  function handleUpgrade(plan: Plan) {
    if (plan.id === "free") return;
    setError(null);
    // Open the upgrade modal on top of the platform shell — the learner
    // stays in context (no full page navigation) and the embedded Stripe
    // checkout mounts inside the modal body.
    setUpgrade({ planId: plan.id, cycle });
  }

  function closeUpgrade() {
    setUpgrade(null);
    setBusyAction(null);
  }

  const subscription = billing?.subscription ?? null;
  const trialEligible = billing?.trialEligible === true;
  const formatDate = (iso: string | null) => (iso ? formatTrialDate(new Date(iso), locale) : "");

  // past_due/unpaid are cancelled at once by the route, not at period end.
  const cancelPrompt = !subscription
    ? ""
    : subscription.status === "past_due" || subscription.status === "unpaid"
      ? t("planTrial.cancelConfirmNow")
      : subscription.trialEnd
        ? t("planTrial.cancelConfirmTrial").replace("{date}", () => formatDate(subscription.trialEnd))
        : t("planTrial.cancelConfirm").replace("{date}", () => formatDate(subscription.currentPeriodEnd));

  // Roda só pelo botão de confirmar do ConfirmDialog, que antes era o OK do
  // window.confirm. O pedido em si não mudou.
  async function handleCancel() {
    if (!subscription) return;
    setError(null);
    setBusyAction("cancel");
    try {
      const updated = await cancelPlanSubscription();
      setBilling((current) => (current ? { ...current, subscription: updated } : current));
    } catch {
      setError("planTrial.cancelError");
    } finally {
      setBusyAction(null);
      // past_due/unpaid voltam `subscription: null`, o que desmonta a janela
      // sem passar pelo onClose: sem isto a pergunta reabriria sozinha se uma
      // assinatura voltasse a aparecer.
      setConfirmingCancel(false);
    }
  }

  async function handleManage() {
    setError(null);
    setBusyAction("portal");
    try {
      await openBillingPortal();
    } catch {
      setError("accountBilling.portalError");
      setBusyAction(null);
    }
  }

  if (!user) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
        {t("accountPlans.signIn")}
      </div>
    );
  }

  return (
    <section ref={sectionRef} tabIndex={-1} className="grid gap-5 outline-none">
      {/* Pendente = as cores de aviso da plataforma (as da faixa de status da
          conta), no lugar da caixa rosa tracejada com titulo dourado. */}
      {!checkoutReady ? (
        <InlineAlert
          tone="warning"
          title={t(priceIdsReady ? "accountPlans.checkoutSoon" : "accountPlans.setupPending")}
        >
          <p className="font-normal">
            {t(priceIdsReady ? "accountPlans.checkoutSoonBody" : "accountPlans.setupPendingBody")}
          </p>
        </InlineAlert>
      ) : null}

      {/* A assinatura num bloco próprio. Antes plano, preço, próxima cobrança,
          fim do teste, "Manage" e "Cancel plan" eram uma frase só de 13px
          separada por pontos, e o cancelar era um link dourado igual aos
          outros. Agora cada dado é uma linha e as duas ações são botões de
          44px, o de cancelar no vermelho de perigo (o latão nunca apaga). */}
      <section className="rounded-lg border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">
          <span>
            {t("accountPlans.currentPlan")}{" "}
            <strong className="text-lg font-bold text-[var(--color-primary)]">
              {currentPlanId === null
                ? planLoadFailed
                  ? t("accountBilling.unavailable")
                  : t("accountPlans.loading")
                : currentPlanId === "free"
                  ? t("accountPlans.withoutSubscription")
                  : (plans.find((plan) => plan.id === currentPlanId)?.name ?? t("accountBilling.unavailable"))}
            </strong>
          </span>
        </p>
        {subscription ? (
          <ul className="mt-4 grid gap-px overflow-hidden rounded-md border fine-rule bg-[var(--color-line)] text-sm text-[var(--color-ink)]">
            <li className="bg-white px-4 py-2.5">
              {t("planTrial.contractedPrice").replace("{price}", () => subscription.contractedPrice
                ? t(subscription.contractedPrice.cycle === "yearly" ? "planTrial.pricePerYear" : "planTrial.pricePerMonth")
                  .replace("{amount}", () => new Intl.NumberFormat(locale, { style: "currency", currency: subscription.contractedPrice!.currency })
                    .format(subscription.contractedPrice!.amountMinor / 100))
                : t("accountBilling.unavailable"))}
            </li>
            {!subscription.cancelAtPeriodEnd && ["active", "trialing"].includes(subscription.status) ? (
              <li className="bg-white px-4 py-2.5">
                {t("planTrial.nextPayment").replace("{amount}", () => subscription.nextPayment
                  ? new Intl.NumberFormat(locale, { style: "currency", currency: subscription.nextPayment.currency })
                    .format(subscription.nextPayment.amountMinor / 100)
                  : t("accountBilling.unavailable"))}
              </li>
            ) : null}
            {subscription.trialEnd && !subscription.cancelAtPeriodEnd ? (
              <li className="bg-white px-4 py-2.5 font-semibold">
                {t("planTrial.trialEnds").replace("{date}", () => formatDate(subscription.trialEnd))}
              </li>
            ) : null}
            {subscription.cancelAtPeriodEnd ? (
              <li className="bg-white px-4 py-2.5 font-semibold">
                {t("planTrial.endsOn").replace("{date}", () =>
                  formatDate(subscription.trialEnd ?? subscription.currentPeriodEnd))}
              </li>
            ) : null}
          </ul>
        ) : null}
        {currentPlanId !== "free" || (subscription && !subscription.cancelAtPeriodEnd) ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {currentPlanId !== "free" ? (
              <Button variant="outline" onClick={handleManage} disabled={busyAction === "portal"}>
                <BusyLabel busy={busyAction === "portal"} idle={t("accountPlans.manage")} busyText={t("accountBilling.openingStripe")} />
              </Button>
            ) : null}
            {subscription && !subscription.cancelAtPeriodEnd ? (
              // Cancelamento online em dois passos: este botão abre a
              // pergunta; só o "Cancel plan" de dentro dela envia o pedido
              // (fim do período, o que no teste quer dizer cobrança zero).
              <Button
                variant="danger"
                aria-haspopup="dialog"
                onClick={() => setConfirmingCancel(true)}
                disabled={busyAction === "cancel"}
              >
                <BusyLabel busy={busyAction === "cancel"} idle={t("planTrial.cancel")} busyText={t("planTrial.cancelling")} />
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* O desconto do anual aparece no próprio botão, como em /pricing: no
          `title` ele só existia para quem parava o mouse em cima.
          O seletor segmentado da casa (aria-pressed): o ciclo muda os preços
          mostrados, é um filtro, não abas. */}
      <div className="w-fit max-w-full">
        <PeriodTabs
          options={billingCycles}
          value={cycle}
          onChange={setCycle}
          label={t("accountPlans.cycle")}
          renderLabel={(option) => (
            <>
              {t(`accountPlans.cycles.${option}.label`)}
              {option === "yearly" ? (
                <>
                  {" "}
                  <span className="ml-1 text-[11px] font-medium opacity-80">
                    {t("publicPages.pricing.17_off")}
                  </span>
                </>
              ) : null}
            </>
          )}
        />
      </div>
      {planLoadFailed ? (
        <LoadErrorAlert onRetry={retryPlanRead} focusRef={sectionRef}>
          {t("accountPlans.planReadError")}
        </LoadErrorAlert>
      ) : null}

      {error ? (
        <InlineAlert tone="error">{t(error)}</InlineAlert>
      ) : null}

      {/* Only the plans on offer. An Enterprise subscriber sees "Enterprise"
          in the line above and changes plan through Manage, like everyone. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {publicPlans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const canPurchase = hasRealStripePriceIds(plan) && checkoutClientReady;
          const isYearly = cycle === "yearly";
          // Always lead with the monthly figure. In yearly mode that's the
          // annualized monthly-equivalent; the exact billed total drops to a
          // smaller line below so the easy-to-scan number stays primary.
          const monthlyFigure = isYearly ? plan.yearlyUsd / 12 : plan.monthlyUsd;

          return (
            // Cartão em coluna flex com o botão em margin-top:auto: o Free
            // lista seis itens e os pagos três, então as alturas divergiam e
            // os "Upgrade" não se alinhavam. Mesma hierarquia de /pricing:
            // preço grande em serifa, comissão numa linha secundária. O plano
            // atual ganha o anel por fora (ring), não borda de 2px, para o
            // conteúdo não andar 1px quando vira o seu.
            <article
              key={plan.id}
              className={
                isCurrent
                  ? "relative flex h-full flex-col rounded-lg border border-[var(--color-primary)] bg-white p-5 shadow-[0_18px_36px_rgba(15,39,68,0.10)] ring-1 ring-[var(--color-primary)]"
                  : "flex h-full flex-col rounded-lg border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {plan.name}
                </p>
                {isCurrent ? <StatusChip status="active" label={t("planTrial.yourTier")} /> : null}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="display-title text-4xl tabular-nums text-[var(--color-primary)]">
                  {formatPrice(Math.round(monthlyFigure))}
                </span>
                <span className="text-sm text-[var(--color-ink-soft)]">
                  {t("accountPlans.perMonth")}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium tabular-nums text-[var(--color-ink-muted)]">
                {isYearly
                  ? t("accountPlans.billedYearly").replace("{price}", () => formatPrice(plan.yearlyUsd))
                  : t("accountPlans.billedMonthly")}
              </p>
              <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-[var(--color-ink-soft)]">
                <span>{t("accountPlans.commission")}</span>
                <span className="font-semibold tabular-nums text-[var(--color-ink)]">
                  {formatPlanCommission(plan)}
                </span>
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--color-ink)]">
                {t(`publicPages.plans.${plan.id}.tagline`)}
              </p>

              <ul className="mt-4 grid gap-1.5 text-xs leading-5 text-[var(--color-ink-soft)]">
                {plan.highlights.map((highlight, index) => (
                  <li key={highlight} className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--color-success-soft)]">
                      <Check
                        aria-hidden="true"
                        size={10}
                        strokeWidth={3}
                        className="text-[var(--color-success-fg)]"
                      />
                    </span>
                    <span>{t(`publicPages.plans.${plan.id}.highlight${index}`)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-5">
                {isCurrent ? (
                  // O chip "Current" no topo do cartão já marca o plano; um
                  // botão desabilitado dizendo "Your plan" era a terceira vez.
                  <p className="text-center text-xs font-semibold text-[var(--color-ink-soft)]">
                    {t("planTrial.currentOffer")}
                  </p>
                ) : currentPlanId !== "free" ? (
                  // Checkout only opens the FIRST paid plan — a second session
                  // would bill both, so the API answers 409. Plan switches go
                  // through the portal, which prorates and swaps in place.
                  <button
                    type="button"
                    onClick={handleManage}
                    disabled={busyAction === "portal"}
                    className="button-outline min-h-11 w-full justify-center px-4 py-2.5 text-sm"
                  >
                    <BusyLabel busy={busyAction === "portal"} idle={t("accountPlans.change")} busyText={t("accountPlans.opening")} />
                  </button>
                ) : (
                  <>
                    {/* Renewal terms right above the button that leads to the
                        card form (US ROSCA): price, interval, trial and date. */}
                    {canPurchase ? (
                      <p className="mb-3 text-[11px] leading-5 text-[var(--color-ink-soft)]">
                        {planDisclosure({ t, locale, plan, cycle, trial: trialEligible })}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleUpgrade(plan)}
                      disabled={!canPurchase}
                      className={
                        canPurchase
                          ? "button-solid min-h-11 w-full justify-center px-4 py-2.5 text-sm"
                          : "button-outline min-h-11 w-full justify-center px-4 py-2.5 text-sm"
                      }
                    >
                      {!canPurchase
                        ? t("accountPlans.activating")
                        : trialEligible
                          ? t("planTrial.cta")
                          : t("accountPlans.upgrade").replace("{plan}", () => plan.name)}
                    </button>
                    {/* O motivo do botão desligado ficava só no `title`, que
                        não aparece no toque nem no teclado. */}
                    {!canPurchase ? (
                      <p className="mt-2 text-center text-xs leading-5 text-[var(--color-ink-soft)]">
                        {t("accountPlans.unavailableHint")}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <footer className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-xs leading-6 text-[var(--color-ink-soft)]">
        {t("accountPlans.footer")}
      </footer>

      <UpgradeModal
        open={upgrade !== null}
        planId={upgrade?.planId ?? null}
        cycle={upgrade?.cycle ?? "monthly"}
        onClose={closeUpgrade}
      />

      {/* A frase é a mesma do antigo window.confirm; o que muda é a caixa. */}
      {confirmingCancel && subscription ? (
        <ConfirmDialog
          title={t("planTrial.cancel")}
          confirmLabel={t("planTrial.cancel")}
          pendingLabel={t("planTrial.cancelling")}
          cancelLabel={t("planTrial.keepPlan")}
          danger
          onConfirm={handleCancel}
          onClose={() => setConfirmingCancel(false)}
        >
          {cancelPrompt}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

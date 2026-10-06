"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { UpgradeModal } from "@/components/account/upgrade-modal";
import { StatusChip } from "@/components/shared/status-chip";
import {
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

const billingCycles: ReadonlyArray<{
  value: PlanBillingCycle;
  label: string;
  hint: string;
}> = [
  { value: "monthly", label: "Monthly", hint: "Pay each month" },
  { value: "yearly", label: "Yearly", hint: "~17% off vs monthly" },
];

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
  // Trial eligibility and the live subscription. null until loaded, and stays
  // null if the read fails: the cards then show the no-trial terms, and the
  // checkout itself still decides (and discloses) the trial on Stripe's page.
  const [billing, setBilling] = useState<PlanBillingState | null>(null);
  // Keyed on the uid, not the user object: a re-fetch on every new object
  // would overwrite the state "Cancel plan" just wrote.
  const uid = user?.uid ?? null;

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
    const unsubscribe = subscribeToUserProfile(
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
    return () => unsubscribe();
  }, [user]);

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

  async function handleCancel() {
    if (!subscription) return;
    const prompt = subscription.trialEnd
      ? t("planTrial.cancelConfirmTrial").replace("{date}", () => formatDate(subscription.trialEnd))
      : t("planTrial.cancelConfirm").replace("{date}", () => formatDate(subscription.currentPeriodEnd));
    if (!window.confirm(prompt)) return;
    setError(null);
    setBusyAction("cancel");
    try {
      const updated = await cancelPlanSubscription();
      setBilling((current) => (current ? { ...current, subscription: updated } : current));
    } catch {
      setError("planTrial.cancelError");
    } finally {
      setBusyAction(null);
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
      <div className="rounded-none border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
        {t("accountPlans.signIn")}
      </div>
    );
  }

  return (
    <section className="grid gap-5">
      {!checkoutReady ? (
        <div className="rounded-none border border-dashed border-[rgba(178,34,52,0.32)] bg-[rgba(178,34,52,0.04)] p-4 text-sm leading-6 text-[var(--color-ink)]">
          <p className="font-semibold text-[var(--color-accent-fg)]">
            {t(priceIdsReady ? "accountPlans.checkoutSoon" : "accountPlans.setupPending")}
          </p>
          <p className="mt-1 text-[var(--color-ink-soft)]">
            {t(priceIdsReady ? "accountPlans.checkoutSoonBody" : "accountPlans.setupPendingBody")}
          </p>
        </div>
      ) : null}

      {/* "CURRENT PLAN / Free" flutuava entre o cartão de abertura e o seletor
          Mensal/Anual, sem moldura, como terceira manchete da página — e o
          cartão Free ainda repetia "Current" no chip e "Your plan" no botão.
          Agora é uma linha: plano atual (+ Gerenciar assinatura) à esquerda e o
          seletor de ciclo à direita, em 13px sem caixa alta. O chip "Current"
          no cartão basta para marcar qual é o seu. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--color-ink-soft)]">
          <span>
            {t("accountPlans.currentPlan")}{" "}
            <strong className="font-bold text-[var(--color-primary)]">
              {currentPlanId === null
                ? planLoadFailed
                  ? t("accountBilling.unavailable")
                  : t("accountPlans.loading")
                : (plans.find((plan) => plan.id === currentPlanId)?.name ?? "Free")}
            </strong>
          </span>
          {subscription?.trialEnd && !subscription.cancelAtPeriodEnd ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-[var(--color-ink)]">
                {t("planTrial.trialEnds").replace("{date}", () => formatDate(subscription.trialEnd))}
              </span>
            </>
          ) : null}
          {subscription?.cancelAtPeriodEnd ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-[var(--color-ink)]">
                {t("planTrial.endsOn").replace("{date}", () =>
                  formatDate(subscription.trialEnd ?? subscription.currentPeriodEnd))}
              </span>
            </>
          ) : null}
          {currentPlanId !== "free" ? (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={handleManage}
                disabled={busyAction === "portal"}
                className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline disabled:opacity-60"
              >
                {t(busyAction === "portal" ? "accountBilling.openingStripe" : "accountPlans.manage")}
              </button>
            </>
          ) : null}
          {subscription && !subscription.cancelAtPeriodEnd ? (
            <>
              <span aria-hidden="true">·</span>
              {/* Online cancellation in one click + confirm: cancel at period
                  end, which during the trial means no charge at all. */}
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={busyAction === "cancel"}
                className="font-semibold text-[var(--color-accent-fg)] underline-offset-4 hover:underline disabled:opacity-60"
              >
                {t(busyAction === "cancel" ? "planTrial.cancelling" : "planTrial.cancel")}
              </button>
            </>
          ) : null}
        </p>
        <div
          role="radiogroup"
          aria-label={t("accountPlans.cycle")}
          className="inline-flex w-fit gap-1 rounded-none border fine-rule bg-[var(--color-surface-soft)] p-1"
        >
          {billingCycles.map((option) => {
            const active = cycle === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCycle(option.value)}
                title={t(`accountPlans.cycles.${option.value}.hint`)}
                className={
                  active
                    ? "rounded-none bg-[var(--color-primary)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-base)]"
                    : "rounded-none px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-primary)]"
                }
              >
                {t(`accountPlans.cycles.${option.value}.label`)}
              </button>
            );
          })}
        </div>
      </header>
      {planLoadFailed ? (
        <p className="text-xs text-[var(--color-ink-soft)]">
          {t("accountPlans.planReadError")}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-none border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {t(error)}
        </p>
      ) : null}

      {/* Only the plans on offer. A retired Plus subscriber sees "Plus" in
          the line above and changes plan through Manage, like everyone. */}
      <div className="grid gap-4 lg:grid-cols-2">
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
            // os "Upgrade" não se alinhavam. Preço em Manrope 800 — a serifa
            // fica para o marketing.
            <article
              key={plan.id}
              className={
                isCurrent
                  ? "relative flex h-full flex-col rounded-none border-2 border-[var(--color-primary)] bg-white p-5 shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
                  : "flex h-full flex-col rounded-none border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {plan.name}
                </p>
                {isCurrent ? <StatusChip status="active" label={t("accountPlans.current")} /> : null}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tabular-nums tracking-[-0.02em] text-[var(--color-primary)]">
                  {formatPrice(Math.round(monthlyFigure))}
                </span>
                <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t("accountPlans.perMonth")}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium tabular-nums text-[var(--color-ink-muted)]">
                {isYearly
                  ? t("accountPlans.billedYearly").replace("{price}", () => formatPrice(plan.yearlyUsd))
                  : t("accountPlans.billedMonthly")}
              </p>
              <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                {t(`publicPages.plans.${plan.id}.tagline`)}
              </p>

              <div className="mt-4 rounded-none border fine-rule bg-[var(--color-surface-soft)] px-3 py-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                  {t("accountPlans.commission")}
                </p>
                <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-[var(--color-primary)]">
                  {plan.commissionPercent}%
                </p>
              </div>

              <ul className="mt-4 grid gap-1.5 text-xs leading-5 text-[var(--color-ink-soft)]">
                {plan.highlights.map((highlight, index) => (
                  <li key={highlight} className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-none bg-[var(--color-success-soft)]">
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
                    {t("accountPlans.yourPlan")}
                  </p>
                ) : currentPlanId !== "free" ? (
                  // Checkout only opens the FIRST paid plan — a second session
                  // would bill both, so the API answers 409. Plan switches go
                  // through the portal, which prorates and swaps in place.
                  <button
                    type="button"
                    onClick={handleManage}
                    disabled={busyAction === "portal"}
                    className="button-outline w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                  >
                    {t(busyAction === "portal" ? "accountPlans.opening" : "accountPlans.change")}
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
                          ? "button-solid w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                          : "button-outline w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                      }
                      title={
                        canPurchase
                          ? undefined
                          : t("accountPlans.unavailableHint")
                      }
                    >
                      {!canPurchase
                        ? t("accountPlans.activating")
                        : trialEligible
                          ? t("planTrial.cta")
                          : t("accountPlans.upgrade").replace("{plan}", () => plan.name)}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <footer className="rounded-none border fine-rule bg-[var(--color-surface-soft)] p-4 text-xs leading-6 text-[var(--color-ink-soft)]">
        {t("accountPlans.footer")}
      </footer>

      <UpgradeModal
        open={upgrade !== null}
        planId={upgrade?.planId ?? null}
        cycle={upgrade?.cycle ?? "monthly"}
        onClose={closeUpgrade}
      />
    </section>
  );
}

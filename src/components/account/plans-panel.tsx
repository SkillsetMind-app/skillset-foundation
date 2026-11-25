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
  // null = we do not know yet. Assuming "free" before loading made a
  // Pro subscriber see "Current plan: Free" with the Free card marked as
  // "Your plan" and no Manage button — flickering on every load, and permanent if
  // the profile failed. Since Manage is the only cancellation path, the
  // optimistic guess hid exactly the control the subscriber was looking for.
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
  // The profile subscription, so "Try again" can read the plan again without leaving the
  // realtime channel; the section stays in both outcomes and receives the focus.
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
        // Failing to load the profile is not evidence of a free plan. Marks it
        // as unknown so the UI does not state "Free" to a subscriber nor
        // hide Manage; the upgrade buttons keep working.
        setPlanLoadFailed(true);
      },
    );
    profileRead.current = subscription;
    return () => {
      profileRead.current = null;
      subscription();
    };
  }, [user]);

  // Goes back to the plan's "Loading..." until the new read responds.
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

  // Runs only from the ConfirmDialog confirm button, which used to be the OK of
  // window.confirm. The request itself did not change.
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
      // past_due/unpaid return `subscription: null`, which unmounts the dialog
      // without going through onClose: without this the question would reopen by itself if a
      // subscription showed up again.
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
      {/* Pending = the platform's warning colors (those of the account status
          strip), instead of the dashed pink box with a gold title. */}
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

      {/* The subscription in its own block. Before, plan, price, next charge,
          trial end, "Manage" and "Cancel plan" were a single 13px sentence
          separated by dots, and cancel was a gold link just like the
          others. Now each datum is a row and the two actions are
          44px buttons, the cancel one in the danger red (brass never deletes). */}
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
              // Online cancellation in two steps: this button opens the
              // question; only the "Cancel plan" inside it sends the request
              // (end of period, which in the trial means zero charge).
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

      {/* The annual discount shows on the button itself, as in /pricing: in
          the `title` it only existed for those who hovered the mouse over it.
          The app's segmented selector (aria-pressed): the cycle changes the prices
          shown, it is a filter, not tabs. */}
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
            // Card as a flex column with the button at margin-top:auto: the Free
            // lists six items and the paid ones three, so the heights diverged and
            // the "Upgrade" buttons did not line up. Same hierarchy as /pricing:
            // big serif price, commission on a secondary line. The current
            // plan gets the ring on the outside (ring), not a 2px border, so the
            // content does not shift 1px when it becomes yours.
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
                  // The "Current" chip at the top of the card already marks the plan; a
                  // disabled button saying "Your plan" was the third time.
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
                    {/* The reason for the disabled button was only in the `title`, which
                        does not show on touch or keyboard. */}
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

      {/* The sentence is the same as the old window.confirm; what changes is the box. */}
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

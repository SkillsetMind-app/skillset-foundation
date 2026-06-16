"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { UpgradeModal } from "@/components/account/upgrade-modal";
import { StatusChip } from "@/components/shared/status-chip";
import {
  hasRealStripePriceIds,
  isBillingConfigured,
  plans,
  type Plan,
  type PlanBillingCycle,
  type PlanId,
} from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import {
  isCheckoutClientConfigured,
  openBillingPortal,
} from "@/lib/payments/billing";

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
  const { user } = useAuth();
  const [cycle, setCycle] = useState<PlanBillingCycle>("monthly");
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>("free");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeState>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToUserProfile(
      user.uid,
      (profile) => {
        setCurrentPlanId(profile?.currentPlanId ?? "free");
      },
      () => {
        // Profile fetch failures keep the user on the safe default (Free)
        // without blocking the page — the upgrade buttons still work.
        setCurrentPlanId("free");
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

  async function handleManage() {
    setError(null);
    setBusyAction("portal");
    try {
      await openBillingPortal();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not open the billing portal.";
      setError(message);
      setBusyAction(null);
    }
  }

  if (!user) {
    return (
      <div className="rounded-[4px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
        Sign in to view and manage your plan.
      </div>
    );
  }

  return (
    <section className="grid gap-5">
      {!checkoutReady ? (
        <div className="rounded-[4px] border border-dashed border-[rgba(178,34,52,0.32)] bg-[rgba(178,34,52,0.04)] p-4 text-sm leading-6 text-[var(--color-ink)]">
          <p className="font-semibold text-[var(--color-accent-fg)]">
            {priceIdsReady
              ? "Card checkout activates soon."
              : "Billing setup pending."}
          </p>
          <p className="mt-1 text-[var(--color-ink-soft)]">
            {priceIdsReady
              ? "Plans are ready, and card checkout is being switched on for this site. Free stays the default plan until then — no action is needed from you."
              : "Paid plans can't be purchased here yet while billing setup finishes. Free still works as the default plan for every account."}
          </p>
        </div>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Current plan
          </p>
          <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
            {plans.find((plan) => plan.id === currentPlanId)?.name ?? "Free"}
          </h2>
        </div>
        {currentPlanId !== "free" ? (
          <button
            type="button"
            onClick={handleManage}
            disabled={busyAction === "portal"}
            className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {busyAction === "portal" ? "Opening Stripe..." : "Manage subscription"}
          </button>
        ) : null}
      </header>

      <div
        role="radiogroup"
        aria-label="Billing cycle"
        className="inline-flex w-fit gap-1 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-1"
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
              className={
                active
                  ? "rounded-[8px] bg-[var(--color-primary)] text-[var(--color-base)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
                  : "rounded-[8px] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-primary)]"
              }
            >
              {option.label}
              <span className="ml-2 text-[10px] font-medium normal-case opacity-80">
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const isPaidPlan = plan.id !== "free";
          const canPurchase =
            isPaidPlan && hasRealStripePriceIds(plan) && checkoutClientReady;
          const isYearly = cycle === "yearly";
          // Always lead with the monthly figure. In yearly mode that's the
          // annualized monthly-equivalent; the exact billed total drops to a
          // smaller line below so the easy-to-scan number stays primary.
          const monthlyFigure =
            isYearly && plan.yearlyUsd > 0
              ? plan.yearlyUsd / 12
              : plan.monthlyUsd;

          return (
            <article
              key={plan.id}
              className={
                isCurrent
                  ? "relative rounded-[4px] border-2 border-[var(--color-primary)] bg-white p-5 shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
                  : "rounded-[4px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {plan.name}
                </p>
                {isCurrent ? <StatusChip status="active" label="Current" /> : null}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="display-title text-3xl tabular-nums text-[var(--color-primary)]">
                  {isPaidPlan
                    ? formatUsdWhole(Math.round(monthlyFigure))
                    : "Free"}
                </span>
                {isPaidPlan ? (
                  <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                    /mo
                  </span>
                ) : null}
              </div>
              {isPaidPlan ? (
                <p className="mt-1 text-[11px] font-medium tabular-nums text-[var(--color-ink-muted)]">
                  {isYearly
                    ? `${formatUsdWhole(plan.yearlyUsd)} billed yearly`
                    : "billed monthly"}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                {plan.tagline}
              </p>

              <div className="mt-4 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-3 py-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                  Commission per sale
                </p>
                <p className="display-title mt-0.5 text-2xl text-[var(--color-primary)]">
                  {plan.commissionPercent}%
                </p>
              </div>

              <ul className="mt-4 grid gap-1.5 text-xs leading-5 text-[var(--color-ink-soft)]">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-1.5">
                    <Check
                      aria-hidden="true"
                      size={12}
                      strokeWidth={2.4}
                      className="mt-1 shrink-0 text-[var(--color-primary)]"
                    />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="button-outline mt-5 w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                >
                  Your plan
                </button>
              ) : isPaidPlan ? (
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan)}
                  disabled={!canPurchase}
                  className={
                    canPurchase
                      ? "button-solid mt-5 w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                      : "button-outline mt-5 w-full justify-center px-3 py-2 text-xs disabled:opacity-60"
                  }
                  title={
                    canPurchase
                      ? undefined
                      : "Card checkout isn't available on this site yet. Check back soon."
                  }
                >
                  {canPurchase ? `Upgrade to ${plan.name}` : "Activating soon"}
                </button>
              ) : (
                <p className="mt-5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  Default tier
                </p>
              )}
            </article>
          );
        })}
      </div>

      <footer className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-xs leading-6 text-[var(--color-ink-soft)]">
        Plan changes are processed by Stripe. Upgrades apply immediately and
        Stripe Billing prorates the difference. Downgrades and cancellations
        take effect at the end of the current billing period. You can update
        your card or download invoices any time from the Stripe Customer Portal.
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

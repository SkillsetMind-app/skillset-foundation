import Link from "next/link";
import { Check, ChevronDown, HelpCircle } from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { Tooltip } from "@/components/shared/tooltip";
import { formatUsd, formatUsdWhole } from "@/data/platform";
import {
  activationFeeUsd,
  isActivationFeeConfigured,
  plans,
  refundWindowDays,
} from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Four plans. Free starts at 10% commission with no subscription. Starter drops it to 5%, Pro to 3%, Plus to 2%. Stripe's processing fee is shown separately so the math is never hidden, and buyers pay your own Stripe account directly — no platform hold, no platform clearing period.",
  path: "/pricing",
});

// $100 sample so the breakdown is easy to read at a glance.
const sampleSaleUsd = 100;
const sampleStripeFeeUsd = sampleSaleUsd * 0.029 + 0.3;

export default function PricingPage() {
  return (
    <PublicPage
      eyebrow="Pricing"
      title="Pricing that lowers as you grow."
      description="Every plan can sell. Paid plans lower the commission and raise your limits."
    >
      {/* Billing toggle + plan grid. Mirrors the monthly/yearly cycle toggle
          in plans-panel.tsx, but stays server-rendered: a native radio group
          drives the reprice purely with CSS (`group-has-[#billing-yearly:checked]`),
          so both price figures ship pre-rendered and no client JS is needed.
          The page keeps `export const metadata` (server-only) intact. */}
      <div className="group mt-8">
        {/* ponytail: CSS-only toggle (peer/has) instead of useState — keeps the
            page a server component so metadata export stays. Real radios keep it
            keyboard-accessible. Upgrade path: extract a client child if the
            reprice ever needs interactivity beyond show/hide. */}
        <fieldset className="mb-5">
          <legend className="sr-only">Billing cycle</legend>
          <div className="inline-flex w-fit gap-1 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-1">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[8px] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-monthly"
                defaultChecked
                className="sr-only"
              />
              Monthly
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[8px] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-yearly"
                className="sr-only"
              />
              Yearly
              <span className="ml-2 text-[11px] font-medium opacity-80">
                ~17% off
              </span>
            </label>
          </div>
        </fieldset>

        <section
          className="grid gap-4 lg:grid-cols-4"
          aria-label="Plan comparison"
        >
          {plans.map((plan, index) => {
            const isHighlight = plan.id === "pro";
            // Yearly figure billed annually; the /mo label shows the
            // annualized monthly-equivalent so the scannable number stays small.
            const yearlyMonthlyEquiv = plan.yearlyUsd / 12;
            return (
              <article
                key={plan.id}
                className={
                  isHighlight
                    ? "relative flex h-full flex-col rounded-[18px] border-2 border-[var(--color-primary)] bg-white p-6 shadow-[0_24px_48px_rgba(15,39,68,0.12)]"
                    : "flex h-full flex-col rounded-[18px] border fine-rule bg-white p-6 shadow-[var(--shadow-soft)]"
                }
              >
                {isHighlight ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                    Most popular
                  </span>
                ) : null}
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {plan.name}
                </p>
                {/* The commission is what a plan actually changes, so it is the
                    big number; the subscription is the small line under it. */}
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="display-title text-4xl text-[var(--color-primary)]">
                    {plan.commissionPercent}%
                  </span>
                  <span className="text-sm text-[var(--color-ink-soft)]">
                    per sale
                  </span>
                </p>
                {plan.monthlyUsd === 0 ? (
                  <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                    {formatUsdWhole(0)}/mo — no subscription
                  </p>
                ) : (
                  <>
                    {/* Monthly line — hidden when the yearly radio is checked. */}
                    <p className="mt-1 text-sm text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:hidden">
                      {formatUsdWhole(plan.monthlyUsd)}/mo
                    </p>
                    {/* Yearly line — shown only when the yearly radio is checked. */}
                    <p className="mt-1 hidden text-sm text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:block">
                      {formatUsd(yearlyMonthlyEquiv)}/mo, billed{" "}
                      {formatUsdWhole(plan.yearlyUsd)} yearly
                    </p>
                  </>
                )}
                <p className="mt-4 text-sm leading-6 text-[var(--color-ink)]">
                  {plan.tagline}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {plan.audience}
                </p>
                {plan.breakEvenGmvUsd ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    Worth it from {formatUsdWhole(plan.breakEvenGmvUsd)}/mo in sales
                  </p>
                ) : null}
                {/* Tied to isActivationFeeConfigured(), not to a hardcoded flag:
                    the fee ships dormant (placeholder Stripe Price), so this line
                    must not claim a charge that cannot happen yet. It appears on
                    the deploy that carries the real price_... id. */}
                {plan.id === "free" && isActivationFeeConfigured() ? (
                  <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
                    Plus a one-time {formatUsd(activationFeeUsd)} fee to activate
                    your storefront, paid once before your first course goes
                    live. Free still has no monthly cost.
                  </p>
                ) : null}
                <ul className="mb-6 mt-5 grid gap-2 text-sm text-[var(--color-ink-soft)]">
                  {plan.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <Check
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2.4}
                        className="mt-1 shrink-0 text-[var(--color-primary)]"
                      />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
                {/* mt-auto pins the button to the bottom so the four cards
                    line up whatever the length of their bullet lists. */}
                <Link
                  href="/auth?mode=signup&path=teacher"
                  className={
                    isHighlight
                      ? "button-solid mt-auto w-full justify-center px-4 py-2.5 text-sm"
                      : "button-outline mt-auto w-full justify-center px-4 py-2.5 text-sm"
                  }
                  aria-label={`Start on ${plan.name}`}
                  data-plan-position={index}
                >
                  {plan.monthlyUsd === 0 ? "Start free" : `Start on ${plan.name}`}
                </Link>
              </article>
            );
          })}
        </section>
      </div>

      {/* Breakdown — same $100 sale across all four tiers so the user can
          see exactly where every cent goes. */}
      <section className="mt-12 rounded-[18px] border fine-rule bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          The math, on a $100 USD sale
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)] sm:text-4xl">
          Same gross, different net.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          A learner pays {formatUsd(sampleSaleUsd)} for a course. Stripe takes
          its standard USD processing fee of {formatUsd(sampleStripeFeeUsd)}{" "}
          (2.9% + $0.30). SkillsetMind takes the plan&apos;s commission. The rest
          goes to you.
        </p>

        <div className="mt-6 overflow-x-auto rounded-[12px] border fine-rule">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-[var(--color-surface-soft)] text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-bold">
                  Plan
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  Gross
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  Platform fee
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  <span className="inline-flex items-center gap-1">
                    Stripe fee
                    <Tooltip content="Stripe's processing fee on each successful charge (2.9% + $0.30 for USD cards, an estimated 5.4% + $0.30 for non-USD). Passed through to you on every plan.">
                      <button
                        type="button"
                        aria-label="What is the Stripe processing fee?"
                        className="inline-flex size-5 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        <HelpCircle
                          aria-hidden="true"
                          size={12}
                          strokeWidth={2}
                        />
                      </button>
                    </Tooltip>
                  </span>
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right font-bold text-[var(--color-primary)]"
                >
                  You receive
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {plans.map((plan) => {
                const platformFee = (sampleSaleUsd * plan.commissionPercent) / 100;
                const net = sampleSaleUsd - platformFee - sampleStripeFeeUsd;
                return (
                  <tr key={plan.id} className="bg-white">
                    <td className="px-4 py-3 font-semibold text-[var(--color-ink)]">
                      {plan.name}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-ink-soft)]">
                      {formatUsd(sampleSaleUsd)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-ink-soft)]">
                      −{formatUsd(platformFee)}
                      <span className="ml-1 text-xs text-[var(--color-ink-muted)]">
                        ({plan.commissionPercent}%)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-ink-soft)]">
                      −{formatUsd(sampleStripeFeeUsd)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--color-primary)]">
                      {formatUsd(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
          International cards (non-USD) use Stripe&apos;s international rate of
          5.4% + $0.30 estimated instead of 2.9% + $0.30. Everything else is identical.
          Both figures are Stripe&apos;s US pricing — your own rates are the ones
          Stripe sets in the country your account is registered in.
        </p>
      </section>

      {/* Operational rules — refund window, direct payouts, plan changes. */}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Refund window
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Learners can self-refund within {refundWindowDays} days of purchase
            if they&apos;ve completed less than half the course and no certificate
            has been issued — once per course. A refund reverses the sale
            automatically, SkillsetMind&apos;s commission included.
          </p>
        </article>
        <article className="rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Payouts
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Buyers pay your Stripe account directly. We never hold your money, so
            there is nothing for us to release — Stripe settles and pays out to
            your bank from your own Stripe balance on its own timing, which
            depends on your country and the payment method. A brand-new account
            waits on Stripe&apos;s verification before its first payout.
          </p>
        </article>
        <article className="rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Plan changes
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Upgrade any time — new commission applies to new sales. Downgrade at
            the end of your billing cycle. Cancel anytime; you keep your
            content and revert to Free.
          </p>
        </article>
      </section>

      {/* FAQ — plan changes, downgrades, and how fees work. Answers are drawn
          straight from the operational-rule cards above and plans.ts truth
          (commission-only model, Stripe fee passed through). Native
          <details>/<summary> = keyboard-accessible, zero JS, tokens-only. */}
      <section className="mt-12" aria-labelledby="pricing-faq-heading">
        <h2
          id="pricing-faq-heading"
          className="display-title text-3xl text-[var(--color-primary)] sm:text-4xl"
        >
          Common questions
        </h2>
        <div className="mt-6 grid gap-3">
          {[
            {
              q: "What happens when I upgrade a plan?",
              a: "Upgrades apply immediately, and the new commission rate takes effect on new sales. Sales made before the change keep the commission rate from the plan you were on at the time. Stripe Billing prorates the subscription difference for the current cycle.",
            },
            {
              q: "What happens when I downgrade or cancel?",
              a: `Downgrades and cancellations take effect at the end of your current billing period — you keep the plan you're paying for until then. If you cancel, you keep all your content and revert to Free (${plans[0].commissionPercent}% commission, no subscription).`,
            },
            {
              q: "How do the fees work on a subscription sale?",
              a: `Two fees come out of each sale, shown separately so the math is never hidden. SkillsetMind takes its plan commission (10% on Free down to 2% on Plus), and Stripe's standard processing fee (2.9% + $0.30 for USD cards, an estimated 5.4% + $0.30 for non-USD) is passed through to you. Everything left over is yours.`,
            },
            {
              q: "When can a sale be refunded, and does it affect my payout?",
              a: `Learners can self-refund within ${refundWindowDays} days of purchase if they've completed less than half the course. Because the buyer paid your Stripe account directly, the refund is debited from your own balance — and SkillsetMind's commission on that sale is returned to you with it, so you never pay a fee on a sale that was undone.`,
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-[16px] border fine-rule bg-white shadow-[var(--shadow-soft)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-[16px] px-5 py-4 text-sm font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                {item.q}
                <ChevronDown
                  aria-hidden="true"
                  size={18}
                  strokeWidth={2.2}
                  className="shrink-0 text-[var(--color-primary)] transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pb-5 text-sm leading-7 text-[var(--color-ink-soft)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-6">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Ready to publish on SkillsetMind?
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Start on Free — upgrade only when the math works in your favor.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/for-creators" className="button-outline px-4 py-2.5 text-sm">
            Creator overview
          </Link>
          <Link
            href="/auth?mode=signup&path=teacher"
            className="button-solid px-4 py-2.5 text-sm"
          >
            Start free
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}

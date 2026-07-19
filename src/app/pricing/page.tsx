import Link from "next/link";
import { Check, ChevronDown, HelpCircle } from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { Tooltip } from "@/components/shared/tooltip";
import { formatUsd } from "@/data/platform";
import { plans, payoutClearDays, refundWindowDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Four plans. Free starts at 10% commission with no subscription. Starter drops it to 5%, Pro to 3%, Plus to 2%. Stripe's processing fee is shown separately so the math is never hidden.",
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
      description="Every feature is included on every plan. The plan you pick only changes the commission SkillsetMind takes per paid sale. Stripe's processing fee is passed through to you transparently — never hidden inside the platform percentage."
    >
      {/* Quick decision hint above the cards — answers the question every
          creator actually asks: 'which plan fits me?'. Break-even numbers
          come straight from plans.ts so they stay in sync if pricing moves. */}
      <aside className="mt-8 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Which plan is for me?
        </p>
        <div className="mt-3 grid gap-3 text-sm text-[var(--color-ink-soft)] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <strong className="block text-[var(--color-ink)]">$0 – $380/mo</strong>
            Stay on Free. No subscription, 10% per sale.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$380 – $3,500/mo</strong>
            Starter pays for itself. 5% per sale; the $19 fee costs less than the commission you save.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$3,500 – $11,000/mo</strong>
            Pro becomes cheaper than Starter. 3% per sale.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$11,000/mo+</strong>
            Plus drops commission to 2%. Worth it past this volume.
          </div>
        </div>
      </aside>

      {/* Billing toggle + plan grid. Mirrors the monthly/yearly cycle toggle
          in plans-panel.tsx, but stays server-rendered: a native radio group
          drives the reprice purely with CSS (`group-has-[#billing-yearly:checked]`),
          so both price figures ship pre-rendered and no client JS is needed.
          The page keeps `export const metadata` (server-only) intact. */}
      <div className="group mt-6">
        {/* ponytail: CSS-only toggle (peer/has) instead of useState — keeps the
            page a server component so metadata export stays. Real radios keep it
            keyboard-accessible. Upgrade path: extract a client child if the
            reprice ever needs interactivity beyond show/hide. */}
        <fieldset className="mb-5">
          <legend className="sr-only">Billing cycle</legend>
          <div className="inline-flex w-fit gap-1 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-1">
            <label className="cursor-pointer rounded-[8px] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-monthly"
                defaultChecked
                className="sr-only"
              />
              Monthly
              <span className="ml-2 text-[10px] font-medium normal-case opacity-80">
                Pay each month
              </span>
            </label>
            <label className="cursor-pointer rounded-[8px] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-yearly"
                className="sr-only"
              />
              Yearly
              <span className="ml-2 text-[10px] font-medium normal-case opacity-80">
                ~17% off vs monthly
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
            // Yearly figure billed annually; the /month label shows the
            // annualized monthly-equivalent so the scannable number stays small.
            const yearlyMonthlyEquiv = plan.yearlyUsd / 12;
            return (
              <article
                key={plan.id}
                className={
                  isHighlight
                    ? "relative rounded-[18px] border-2 border-[var(--color-primary)] bg-white p-6 shadow-[0_24px_48px_rgba(15,39,68,0.12)]"
                    : "rounded-[18px] border fine-rule bg-white p-6 shadow-[var(--shadow-soft)]"
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
                {plan.monthlyUsd === 0 ? (
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="display-title text-4xl text-[var(--color-primary)]">
                      Free
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Monthly price — hidden when the yearly radio is checked. */}
                    <div className="mt-3 flex items-baseline gap-1 group-has-[#billing-yearly:checked]:hidden">
                      <span className="display-title text-4xl text-[var(--color-primary)]">
                        {formatUsd(plan.monthlyUsd)}
                      </span>
                      <span className="text-sm text-[var(--color-ink-soft)]">
                        /month
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:hidden">
                      or {formatUsd(plan.yearlyUsd)} billed yearly
                    </p>
                    {/* Yearly price — shown only when the yearly radio is checked. */}
                    <div className="mt-3 hidden items-baseline gap-1 group-has-[#billing-yearly:checked]:flex">
                      <span className="display-title text-4xl text-[var(--color-primary)]">
                        {formatUsd(yearlyMonthlyEquiv)}
                      </span>
                      <span className="text-sm text-[var(--color-ink-soft)]">
                        /month
                      </span>
                    </div>
                    <p className="mt-1 hidden text-xs text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:block">
                      {formatUsd(plan.yearlyUsd)} billed yearly
                    </p>
                  </>
                )}
                <p className="mt-4 text-sm leading-6 text-[var(--color-ink)]">
                  {plan.tagline}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {plan.audience}
                </p>
                <div className="mt-5 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                    Commission per sale
                  </p>
                  <p className="mt-1 display-title text-3xl text-[var(--color-primary)]">
                    {plan.commissionPercent}%
                  </p>
                  {plan.breakEvenGmvUsd ? (
                    <p className="mt-1 text-[11px] text-[var(--color-ink-soft)]">
                      Worth it from {formatUsd(plan.breakEvenGmvUsd)}/mo in sales
                    </p>
                  ) : null}
                </div>
                <ul className="mt-5 grid gap-2 text-sm text-[var(--color-ink-soft)]">
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
                <Link
                  href="/auth?mode=signup&path=teacher"
                  className={
                    isHighlight
                      ? "button-solid mt-6 w-full justify-center px-4 py-2.5 text-sm"
                      : "button-outline mt-6 w-full justify-center px-4 py-2.5 text-sm"
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
                        className="inline-flex size-5 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
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
        </p>
      </section>

      {/* Operational rules — refund window, payout clearance, plan changes. */}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Refund window
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Learners can self-refund within {refundWindowDays} days of purchase
            if they&apos;ve completed less than half the course. A refund reverses
            the sale automatically, SkillsetMind&apos;s commission included.
          </p>
        </article>
        <article className="rounded-[16px] border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Payout clearance
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Your earnings clear from pending to available {payoutClearDays}{" "}
            days after each sale — well past the {refundWindowDays}-day refund
            window, so payouts never need to be clawed back.
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
              a: `Learners can self-refund within ${refundWindowDays} days of purchase if they've completed less than half the course, which reverses the sale automatically — SkillsetMind's commission included. Your earnings clear from pending to available ${payoutClearDays} days after each sale, well past the ${refundWindowDays}-day refund window, so a cleared payout never needs to be clawed back.`,
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

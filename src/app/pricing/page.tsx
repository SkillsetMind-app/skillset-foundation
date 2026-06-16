import Link from "next/link";
import { Check, HelpCircle } from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { Tooltip } from "@/components/shared/tooltip";
import { formatUsd } from "@/data/platform";
import { plans, payoutClearDays, refundWindowDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Four plans. Free starts at 8% commission with no subscription. Starter drops it to 4%, Pro to 1%, Plus to 0%. Stripe's processing fee is shown separately so the math is never hidden.",
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
      description="Every feature is included on every plan. The plan you pick only changes the commission Skillset takes per paid sale. Stripe's processing fee is passed through to you transparently — never hidden inside the platform percentage."
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
            <strong className="block text-[var(--color-ink)]">$0 – $475/mo</strong>
            Stay on Free. No subscription, 8% per sale.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$475 – $2,333/mo</strong>
            Starter pays for itself. 4% per sale; the $19 fee costs less than the commission you save.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$2,333 – $11,000/mo</strong>
            Pro becomes cheaper than Starter. 1% per sale.
          </div>
          <div>
            <strong className="block text-[var(--color-ink)]">$11,000/mo+</strong>
            Plus zeroes out commission. Worth it past this volume.
          </div>
        </div>
      </aside>

      <section
        className="mt-6 grid gap-4 lg:grid-cols-4"
        aria-label="Plan comparison"
      >
        {plans.map((plan, index) => {
          const isHighlight = plan.id === "pro";
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
              <div className="mt-3 flex items-baseline gap-1">
                <span className="display-title text-4xl text-[var(--color-primary)]">
                  {plan.monthlyUsd === 0 ? "Free" : formatUsd(plan.monthlyUsd)}
                </span>
                {plan.monthlyUsd > 0 ? (
                  <span className="text-sm text-[var(--color-ink-soft)]">
                    /month
                  </span>
                ) : null}
              </div>
              {plan.yearlyUsd > 0 ? (
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  or {formatUsd(plan.yearlyUsd)} billed yearly
                </p>
              ) : null}
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
          (2.9% + $0.30). Skillset takes the plan&apos;s commission. The rest
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
                      <HelpCircle
                        aria-hidden="true"
                        size={12}
                        strokeWidth={2}
                        className="cursor-help text-[var(--color-ink-muted)]"
                      />
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
            the sale automatically, Skillset&apos;s commission included.
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

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-6">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Ready to publish on Skillset?
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

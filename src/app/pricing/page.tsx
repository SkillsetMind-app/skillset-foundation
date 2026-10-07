import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";
import { Check, ChevronDown, HelpCircle } from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { Tooltip } from "@/components/shared/tooltip";
import { formatUsd, formatUsdWhole } from "@/data/platform";
import {
  formatPlanCommission,
  PER_SALE_FIXED_FEE_USD,
  publicPlans,
  RECOMMENDED_PLAN_ID,
  refundWindowDays,
} from "@/data/plans";
import { planDisclosure } from "@/lib/payments/plan-disclosure";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.pricing.pricing"),
    description:
      t("publicPages.pricing.plans_with_a_free_trial"),
    path: "/pricing",
  });
}

// $100 sample so the breakdown is easy to read at a glance.
const sampleSaleUsd = 100;
const sampleStripeFeeUsd = sampleSaleUsd * 0.029 + 0.3;

export default async function PricingPage() {
  const { locale, t } = await getServerTranslation();

  return (
    <PublicPage
      eyebrow={t("publicPages.pricing.pricing")}
      title={t("publicPages.pricing.pricing_that_lowers_as_you_grow")}
      description={t("publicPages.pricing.every_plan_can_sell_paid_plans")}
    >
      {/* Billing toggle + plan grid. Mirrors the monthly/yearly cycle toggle
          in plans-panel.tsx, but stays server-rendered: a native radio group
          drives the reprice purely with CSS (`group-has-[#billing-yearly:checked]`),
          so both price figures ship pre-rendered and no client JS is needed.
          Metadata remains server-rendered in the selected language. */}
      <div className="group mt-8">
        {/* ponytail: CSS-only toggle (peer/has) instead of useState — keeps the
            page a server component so metadata export stays. Real radios keep it
            keyboard-accessible. Upgrade path: extract a client child if the
            reprice ever needs interactivity beyond show/hide. */}
        <fieldset className="mb-5">
          <legend className="sr-only">{t("publicPages.pricing.billing_cycle")}</legend>
          <div className="inline-flex w-fit gap-1 rounded-md border fine-rule bg-[var(--color-surface-soft)] p-1">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-monthly"
                defaultChecked
                className="sr-only"
              />
              {t("publicPages.pricing.monthly")}
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm px-3 py-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)] has-[:checked]:text-[var(--color-base)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]">
              <input
                type="radio"
                name="billing-cycle"
                id="billing-yearly"
                className="sr-only"
              />
              {t("publicPages.pricing.yearly")}<span className="ml-2 text-[11px] font-medium opacity-80">
                {t("publicPages.pricing.17_off")}
              </span>
            </label>
          </div>
        </fieldset>

        <section
          className="grid gap-4 lg:grid-cols-3"
          aria-label={t("publicPages.pricing.plan_comparison")}
        >
          {publicPlans.map((plan, index) => {
            const isHighlight = plan.id === RECOMMENDED_PLAN_ID;
            // Yearly figure billed annually; the /mo label shows the
            // annualized monthly-equivalent so the scannable number stays small.
            const yearlyMonthlyEquiv = plan.yearlyUsd / 12;
            return (
              <article
                key={plan.id}
                className={
                  isHighlight
                    ? "relative flex h-full flex-col rounded-lg border-2 border-[var(--color-primary)] bg-white p-6 shadow-[0_24px_48px_rgba(15,39,68,0.12)]"
                    : "flex h-full flex-col rounded-lg border fine-rule bg-white p-6 shadow-[var(--shadow-soft)]"
                }
              >
                {isHighlight ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                    {t("publicPages.pricing.recommended")}
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
                    {t("publicPages.pricing.per_sale_with_fixed").replace("{fixed}", () => formatUsd(PER_SALE_FIXED_FEE_USD))}
                  </span>
                </p>
                {/* Monthly line — hidden when the yearly radio is checked. */}
                <p className="mt-1 text-sm text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:hidden">
                  {formatUsdWhole(plan.monthlyUsd)}{t("publicPages.pricing.mo")}
                </p>
                {/* Yearly line — shown only when the yearly radio is checked. */}
                <p className="mt-1 hidden text-sm text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:block">
                  {formatUsd(yearlyMonthlyEquiv)}{t("publicPages.pricing.mo_billed")}{" "}
                  {formatUsdWhole(plan.yearlyUsd)} {t("publicPages.pricing.yearly_2")}
                </p>
                <p className="mt-4 text-sm leading-6 text-[var(--color-ink)]">
                  {t(`publicPages.plans.${plan.id}.tagline`)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {t(`publicPages.plans.${plan.id}.audience`)}
                </p>
                <ul className="mb-6 mt-5 grid gap-2 text-sm text-[var(--color-ink-soft)]">
                  {plan.highlights.map((highlight, highlightIndex) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <Check
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2.4}
                        className="mt-1 shrink-0 text-[var(--color-primary)]"
                      />
                      <span>{t(`publicPages.plans.${plan.id}.highlight${highlightIndex}`)}</span>
                    </li>
                  ))}
                </ul>
                {/* Renewal terms next to the button, per cycle (US ROSCA): the
                    same text the in-app card and Stripe Checkout show. mt-auto
                    pins this block to the bottom so both cards line up. */}
                <div className="mt-auto grid gap-3">
                  <p className="text-xs leading-5 text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:hidden">
                    {planDisclosure({ t, locale, plan, cycle: "monthly", trial: true })}
                  </p>
                  <p className="hidden text-xs leading-5 text-[var(--color-ink-soft)] group-has-[#billing-yearly:checked]:block">
                    {planDisclosure({ t, locale, plan, cycle: "yearly", trial: true })}
                  </p>
                  <Link
                    href="/auth?mode=signup&path=teacher"
                    className={
                      isHighlight
                        ? "button-solid w-full justify-center px-4 py-2.5 text-sm"
                        : "button-outline w-full justify-center px-4 py-2.5 text-sm"
                    }
                    aria-label={`${t("planTrial.cta")} — ${plan.name}`}
                    data-plan-position={index}
                  >
                    {t("planTrial.cta")}
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
        {/* Enterprise is not a card: it is set up by hand, so it is a contact. */}
        <p className="mt-4 text-sm">
          <Link
            href="/contact?subject=enterprise"
            className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
          >
            {t("publicPages.pricing.enterprise_talk_to_us")}
          </Link>
        </p>
        <p className="mt-4 text-xs leading-5 text-[var(--color-ink-muted)]">
          {t("planTrial.publicNote")}
        </p>
      </div>

      {/* Breakdown — same $100 sale across every plan so the user can see
          exactly where every cent goes. */}
      <section className="mt-12 rounded-lg border fine-rule bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("publicPages.pricing.the_math_on_a_100_usd")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)] sm:text-4xl">
          {t("publicPages.pricing.same_gross_different_net")}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("publicPages.pricing.a_learner_pays")}{formatUsd(sampleSaleUsd)} {t("publicPages.pricing.for_a_course_stripe_takes_its")}{formatUsd(sampleStripeFeeUsd)}{" "}
          {t("publicPages.pricing.2_9_0_30_skillsetmind_takes")}
        </p>

        <div className="mt-6 overflow-x-auto rounded-lg border fine-rule">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-[var(--color-surface-soft)] text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-bold">
                  {t("publicPages.pricing.plan")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  {t("publicPages.pricing.gross")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  {t("publicPages.pricing.platform_fee")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-bold">
                  <span className="inline-flex items-center gap-1">
                    {t("publicPages.pricing.stripe_fee")}<Tooltip content={t("publicPages.pricing.stripe_s_processing_fee_on_each")}>
                      <button
                        type="button"
                        aria-label={t("publicPages.pricing.what_is_the_stripe_processing_fee")}
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
                  {t("publicPages.pricing.you_receive")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {publicPlans.map((plan) => {
                const platformFee =
                  (sampleSaleUsd * plan.commissionPercent) / 100 + PER_SALE_FIXED_FEE_USD;
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
                        ({formatPlanCommission(plan)})
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
          {t("publicPages.pricing.international_cards_non_usd_use_stripe")}
        </p>
      </section>

      {/* Operational rules — refund window, direct payouts, plan changes. */}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("publicPages.pricing.refund_window")}
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("publicPages.pricing.learners_can_self_refund_within")}{refundWindowDays} {t("publicPages.pricing.days_of_purchase_if_they_ve")}
          </p>
        </article>
        <article className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("publicPages.pricing.payouts")}
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("publicPages.pricing.buyers_pay_your_stripe_account_directly")}
          </p>
        </article>
        <article className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("publicPages.pricing.plan_changes")}
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("publicPages.pricing.upgrade_any_time_new_commission_applies")}
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
          {t("publicPages.pricing.common_questions")}
        </h2>
        <div className="mt-6 grid gap-3">
          {[
            {
              q: t("publicPages.pricing.what_happens_when_i_upgrade_a"),
              a: t("publicPages.pricing.upgrades_apply_immediately_and_the_new"),
            },
            {
              q: t("publicPages.pricing.what_happens_when_i_downgrade_or"),
              a: t("publicPages.pricing.downgrades_and_cancellations_take_effect_at"),
            },
            {
              q: t("publicPages.pricing.how_do_the_fees_work_on"),
              a: t("publicPages.pricing.two_fees_come_out_of_each"),
            },
            {
              q: t("publicPages.pricing.when_can_a_sale_be_refunded"),
              a: t("publicPages.pricing.learners_can_self_refund_within_days").replace("{value0}", String(refundWindowDays)),
            },
          ].map((item, index) => (
            <details
              key={index}
              className="group rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-5 py-4 text-sm font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
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

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-6">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("publicPages.pricing.ready_to_publish_on_skillsetmind")}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {t("publicPages.pricing.start_with_a_free_trial")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/for-creators" className="button-outline px-4 py-2.5 text-sm">
            {t("publicPages.pricing.creator_overview")}
          </Link>
          <Link
            href="/auth?mode=signup&path=teacher"
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("publicPages.pricing.start_free")}
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}

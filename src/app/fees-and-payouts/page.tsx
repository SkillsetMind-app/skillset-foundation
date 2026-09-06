import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { plans, refundWindowDays } from "@/data/plans";



export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({ title: t("publicPages.fees.fees_and_payouts"), description: t("publicPages.fees.skillsetmind_is_not_a_middleman_for"), path: "/fees-and-payouts" });
}

export default async function FeesAndPayoutsPage() {
  const { t } = await getServerTranslation();
  const policies = [
    [
      t("publicPages.fees.you_get_paid_directly"),
      t("publicPages.fees.learners_pay_your_stripe_account_not"),
    ],
    [
      t("publicPages.fees.platform_fee"),
      t("publicPages.fees.plan_based_every_plan_includes_the").replace("{value0}", String(plans
        .map((plan) => `${plan.name} ${plan.commissionPercent}%`)
        .join(" · "))),
    ],
    [
      t("publicPages.fees.stripe_processing_fee"),
      t("publicPages.fees.charged_by_stripe_to_your_account"),
    ],
    [
      t("publicPages.fees.refund_window"),
      t("publicPages.fees.self_serve_for_days_from_purchase").replace("{value0}", String(refundWindowDays)),
    ],
    [
      t("publicPages.fees.payout_schedule"),
      t("publicPages.fees.there_is_no_platform_clearance_period"),
    ],
    [
      t("publicPages.fees.payout_account"),
      t("publicPages.fees.creators_connect_stripe_before_selling_any"),
    ],
    [
      t("publicPages.fees.currency"),
      t("publicPages.fees.marketplace_shows_usd_by_default_stripe"),
    ],
    [
      t("publicPages.fees.taxes"),
      t("publicPages.fees.stripe_tax_can_be_enabled_per"),
    ],
    [
      t("publicPages.fees.disputes_and_chargebacks"),
      t("publicPages.fees.as_merchant_of_record_you_carry"),
    ],
  ];

  return (
    <PublicPage
      eyebrow={t("publicPages.fees.fees_and_payouts")}
      title={t("publicPages.fees.your_buyers_pay_you_directly")}
      description={t("publicPages.fees.skillsetmind_is_not_a_middleman_for")}
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {policies.map(([title, detail]) => (
          <article
            key={title}
            className="rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {title}
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {detail}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-10 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-6">
        <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("publicPages.fees.full_plan_comparison_sample_breakdowns_and")}{" "}
          <Link
            href="/pricing"
            className="font-semibold text-[var(--color-primary)] underline underline-offset-2"
          >
            {t("publicPages.fees.pricing_page")}
          </Link>
          .
        </p>
      </div>
    </PublicPage>
  );
}

import { getServerTranslation } from "@/lib/i18n/server";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/page-metadata";



export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.promise.the_skillsetmind_promise"),
    description:
      t("publicPages.promise.skillsetmind_commitments_to_creators_and_learners"),
    path: "/promise",
  });
}

export default async function PromisePage() {
  const { t } = await getServerTranslation();
  const promises = [
    {
      number: "01",
      // NOTE(fee-lock): the engine has no per-creator rate snapshot yet —
      // canonicalPlatformFeeBpsForPlan always returns the CURRENT ladder. The
      // 2026-07 pivot to 10/5/3/2 was applied with zero active creators, so no
      // published rate was raised on anyone. From launch on, this promise is
      // binding: any future ladder change requires either a signup-rate snapshot
      // in the engine or the 90-day notice below. Tracked in PR #18.
      title: t("publicPages.promise.fee_lock_for_24_months"),
      body: t("publicPages.promise.the_commission_rate_of_the_plan"),
      practice:
        t("publicPages.promise.if_a_creator_joins_on_free"),
    },
    {
      number: "02",
      title: t("publicPages.promise.no_plan_ever_blocks_you_from"),
      body: t("publicPages.promise.the_selling_engine_is_on_every"),
      practice:
        t("publicPages.promise.a_creator_on_free_runs_a"),
    },
    {
      number: "03",
      title: t("publicPages.promise.data_portability_one_click"),
      body: t("publicPages.promise.at_any_moment_you_can_export"),
      practice:
        t("publicPages.promise.skillsetmind_can_host_your_business_but"),
    },
    {
      number: "04",
      title: t("publicPages.promise.cancellation_in_one_click"),
      body: t("publicPages.promise.delete_your_account_in_one_click"),
      practice:
        t("publicPages.promise.leaving_should_be_a_product_action"),
    },
    {
      number: "05",
      title: t("publicPages.promise.we_never_hold_your_money"),
      body: t("publicPages.promise.your_buyers_pay_your_stripe_account"),
      practice:
        t("publicPages.promise.your_sale_lands_in_your_own"),
    },
    {
      number: "06",
      title: t("publicPages.promise.human_support_sla"),
      body: t("publicPages.promise.financial_questions_refunds_payouts_holds_chargebacks"),
      practice:
        t("publicPages.promise.money_issues_do_not_belong_behind"),
    },
  ];

  return (
    <div className="page-shell">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden bg-[var(--color-primary)] text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
          <div
            className="absolute inset-0 opacity-[0.1]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 28%, rgba(255,255,255,0.45), transparent 32%), radial-gradient(circle at 86% 64%, rgba(178,34,52,0.46), transparent 34%)",
            }}
          />
          {/* Engraved-editorial security texture — the same certificate/banknote
              line-work as the home hero and auth panel. mix-blend-screen lifts
              only the light engraving over the navy, filling the open right side
              beside the left-aligned copy and tying the three hero moments
              (home, auth, promise) into one brand system. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[url(/brand/hero-engraving-mobile.webp)] bg-cover bg-center bg-no-repeat opacity-[0.5] mix-blend-screen lg:bg-[url(/brand/hero-engraving-desktop.webp)]"
          />
          <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-16 sm:px-8 lg:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/78">
              {t("publicPages.promise.the_skillsetmind_creator_promise")}
            </p>
            <h1 className="display-title mt-5 max-w-4xl text-5xl leading-none text-white sm:text-7xl">
              {t("publicPages.promise.six_commitments_in_writing_public")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-white/78 sm:text-lg">
              {t("publicPages.promise.these_promises_are_contractual_product_rules")}
            </p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
        </section>

        <section className="mx-auto grid w-full max-w-5xl gap-5 px-6 py-14 sm:px-8 lg:py-20">
          {promises.map((promise) => (
            <article
              key={promise.number}
              className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8"
            >
              <div className="grid gap-5 lg:grid-cols-[120px_1fr]">
                <p className="display-title text-7xl leading-none text-[var(--color-accent-soft)]">
                  {promise.number}
                </p>
                <div>
                  <h2 className="display-title text-4xl leading-tight text-[var(--color-primary)]">
                    {promise.title}
                  </h2>
                  <p className="mt-4 text-sm leading-8 text-[var(--color-ink-soft)]">
                    {promise.body}
                  </p>
                  <div className="mt-5 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {t("publicPages.promise.what_this_means_in_practice")}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
                      {promise.practice}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-16 sm:px-8">
          <div className="rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("publicPages.promise.these_are_not_aspirations_they_are")}
            </p>
            <Link href="/promise/changelog" className="button-solid mt-5 px-4 py-2.5 text-sm">
              {t("publicPages.promise.read_the_changelog")}
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

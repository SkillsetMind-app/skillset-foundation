import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { planById } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";



const freePlan = planById("free");

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.creators.teach_on_skillsetmind"),
    description: t("publicPages.creators.publish_professional_courses_to_a_global").replace("{value0}", String(freePlan.commissionPercent)),
    path: "/for-creators",
  });
}

export default async function ForCreatorsPage() {
  const { t } = await getServerTranslation();
  const creatorTools = [
    t("publicPages.creators.course_builder_with_modules_lessons_previews"),
    t("publicPages.creators.protected_student_workspace_with_progress_files"),
    t("publicPages.creators.course_linked_community_events_and_future"),
    t("publicPages.creators.stripe_connect_onboarding_refund_controls_and"),
    t("publicPages.creators.professional_verification_up_front_then_automated"),
    t("publicPages.creators.shareable_course_links_for_simple_launch"),
  ];

  return (
    <PublicPage
      eyebrow={t("publicPages.creators.for_creators")}
      title={t("publicPages.creators.teach_with_a_real_course_operating")}
      description={t("publicPages.creators.skillsetmind_is_designed_for_experts_who")}
    >
      <section className="mt-8 rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 gap-5 sm:flex sm:gap-8">
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                {freePlan.commissionPercent}%
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                {t("publicPages.creators.commission_on_free")}
              </p>
            </div>
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                $0
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                {t("publicPages.creators.to_start")}
              </p>
            </div>
            <div>
              <p className="display-title text-3xl text-[var(--color-primary)]">
                {t("publicPages.creators.direct")}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                {t("publicPages.creators.buyer_pays_you")}
              </p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("publicPages.creators.buyers_are_charged_on_your_own")}
            </p>
            <Link
              href="/pricing"
              className="mt-2 inline-flex text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
            >
              {t("publicPages.creators.see_all_four_plans")}
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-3">
          {creatorTools.map((tool) => (
            <div
              key={tool}
              className="rounded-[14px] border fine-rule bg-white p-5 text-sm font-semibold leading-7 text-[var(--color-ink)] shadow-[var(--shadow-soft)]"
            >
              {tool}
            </div>
          ))}
        </div>
        <aside className="primary-fill-card rounded-[18px] border border-[var(--color-line)] bg-[var(--color-primary)] p-6 text-white shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
            {t("publicPages.creators.creator_path")}
          </p>
          <h2 className="display-title mt-3 text-4xl">
            {t("publicPages.creators.start_as_a_creator_publish_after")}
          </h2>
          <p className="mt-4 text-sm leading-7 text-white/78">
            {t("publicPages.creators.creators_can_draft_courses_immediately_professional")}
          </p>
          <Link href="/auth?mode=signup&path=teacher" className="button-solid-light mt-6 px-4 py-2.5 text-sm">
            {t("publicPages.creators.create_account")}
          </Link>
        </aside>
      </section>
    </PublicPage>
  );
}

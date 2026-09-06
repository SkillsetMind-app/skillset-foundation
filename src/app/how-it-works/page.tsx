import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { getServerTranslation } from "@/lib/i18n/server";
import {
  BadgeCheck,
  Compass,
  GraduationCap,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { PublicPage } from "@/components/site/public-page";

type Step = {
  title: string;
  detail: string;
  Icon: LucideIcon;
};



export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({ title: t("publicPages.how.how_it_works"), description: t("publicPages.how.skillsetmind_keeps_the_main_loop_simple"), path: "/how-it-works" });
}

export default async function HowItWorksPage() {
  const { t } = await getServerTranslation();
  const steps: ReadonlyArray<Step> = [
    {
      title: t("publicPages.how.discover"),
      detail:
        t("publicPages.how.learners_browse_the_marketplace_by_category"),
      Icon: Compass,
    },
    {
      title: t("publicPages.how.enroll"),
      detail:
        t("publicPages.how.multi_currency_checkout_charged_straight_to"),
      Icon: Wallet,
    },
    {
      title: t("publicPages.how.learn"),
      detail:
        t("publicPages.how.students_progress_through_lessons_files_live"),
      Icon: GraduationCap,
    },
    {
      title: t("publicPages.how.verify"),
      detail:
        t("publicPages.how.meet_the_course_requirements_and_earn"),
      Icon: BadgeCheck,
    },
  ];

  return (
    <PublicPage
      eyebrow={t("publicPages.how.how_it_works")}
      title={t("publicPages.how.course_first_learning_with_community_built")}
      description={t("publicPages.how.skillsetmind_keeps_the_main_loop_simple")}
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const { Icon } = step;
          return (
            <article
              key={step.title}
              className="group rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.18)] hover:shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
            >
              <div className="flex items-center justify-between">
                <span
                  className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-primary)] text-[var(--color-base)] shadow-[0_10px_22px_rgba(26,54,93,0.18)]"
                  aria-hidden="true"
                >
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <span
                  aria-hidden="true"
                  className="display-title text-3xl leading-none text-[var(--color-accent-soft)]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h2 className="mt-5 text-lg font-bold text-[var(--color-ink)]">
                {step.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                {step.detail}
              </p>
            </article>
          );
        })}
      </section>
    </PublicPage>
  );
}

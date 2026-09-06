import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";

import { AssistantPanel } from "@/components/help/assistant-panel";
import { HelpCenter } from "@/components/help/help-center";
import { PublicPage } from "@/components/site/public-page";
import { helpFaqCategories } from "@/data/help-faq";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// FAQ content lives in src/data/help-faq.ts — shared with the platform
// assistant so the bot and this page can never disagree.

const SUPPORT_EMAIL = "support@skillsetmind.com";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.help.help_center"),
    description:
      t("publicPages.help.answers_about_courses_payments_payouts_refunds"),
    path: "/help",
  });
}

export default async function HelpPage() {
  const { t } = await getServerTranslation();

  return (
    <PublicPage
      eyebrow={t("publicPages.help.help")}
      title={t("publicPages.help.help_center_2")}
      description={t("publicPages.help.short_answers_to_the_questions_learners")}
    >
      <AssistantPanel />

      <HelpCenter categories={helpFaqCategories} />

      <div className="mt-12 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-7 text-center sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("publicPages.help.still_stuck")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)] sm:text-4xl">
          {t("publicPages.help.talk_to_a_real_person")}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("publicPages.help.payment_payout_or_course_review_questions")}
        </p>
        {/* O botão principal ia para /support, que exige login: para um
            visitante era uma tela de login sem aviso. E-mail é o caminho sem
            conta; o ticket fica como segunda opção, dito para quem é. */}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Support`}
            className="button-solid inline-flex px-4 py-2.5 text-sm"
          >
            {t("publicPages.help.email_support")}
          </a>
          <Link
            href="/support"
            className="button-outline inline-flex px-4 py-2.5 text-sm"
          >
            {t("publicPages.help.have_an_account_open_a_ticket")}
          </Link>
        </div>
      </div>
    </PublicPage>
  );
}

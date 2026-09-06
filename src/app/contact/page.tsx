import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const SUPPORT_EMAIL = "support@skillsetmind.com";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.contact.contact"),
    description:
      t("publicPages.contact.reach_the_skillsetmind_team_for_support"),
    path: "/contact",
  });
}

// Todo caminho daqui funciona sem login. /support é uma tela protegida: para
// um visitante, "Open a support ticket" virava um formulário de login sem
// aviso. O ticket continua existindo, mas anunciado como o que é (só para
// quem tem conta), no parágrafo de abertura.


export default async function ContactPage() {
  const { t } = await getServerTranslation();
  const contactRoutes = [
    {
      label: t("publicPages.contact.general_inquiries"),
      value:
        t("publicPages.contact.questions_about_programs_access_and_the"),
      action: {
        label: t("publicPages.contact.email_the_team"),
        href: `mailto:${SUPPORT_EMAIL}?subject=General%20inquiry`,
        external: true,
      },
    },
    {
      label: t("publicPages.contact.educator_applications"),
      value:
        t("publicPages.contact.for_professionals_who_want_to_teach"),
      action: {
        label: t("publicPages.contact.explore_teaching_on_skillsetmind"),
        href: "/for-creators",
        external: false,
      },
    },
    {
      label: t("publicPages.contact.support_and_safety"),
      value:
        t("publicPages.contact.a_dedicated_route_for_learner_care"),
      action: {
        label: t("publicPages.contact.email_support"),
        href: `mailto:${SUPPORT_EMAIL}?subject=Support`,
        external: true,
      },
    },
    {
      label: t("publicPages.contact.partnerships_and_press"),
      value:
        t("publicPages.contact.for_institutions_regional_collaborators_strategic_growth"),
      action: {
        label: t("publicPages.contact.email_partnerships"),
        href: `mailto:${SUPPORT_EMAIL}?subject=Partnership%20or%20press`,
        external: true,
      },
    },
  ] as const;

  return (
    <PublicPage
      eyebrow={t("publicPages.contact.contact")}
      title={t("publicPages.contact.reach_the_right_team_for_support")}
      description={
        <>
          {t("publicPages.contact.prefer_email_write_to")}{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          {t("publicPages.contact.and_we_ll_route_it_to")}{" "}
          <Link
            href="/support"
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            {t("publicPages.contact.open_a_tracked_ticket")}
          </Link>{" "}
          {t("publicPages.contact.from_inside_the_platform")}</>
      }
    >
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {contactRoutes.map((route) => (
          <div
            key={route.label}
            className="flex flex-col rounded-[14px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
              {route.label}
            </p>
            <p className="mt-3 flex-1 text-sm leading-7 text-[var(--color-ink-soft)]">
              {route.value}
            </p>
            {route.action.external ? (
              <a
                href={route.action.href}
                className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                {route.action.label} &rarr;
              </a>
            ) : (
              <Link
                href={route.action.href}
                className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                {route.action.label} &rarr;
              </Link>
            )}
          </div>
        ))}
      </div>
    </PublicPage>
  );
}

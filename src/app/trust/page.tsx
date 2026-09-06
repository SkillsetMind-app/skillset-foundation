import { getServerTranslation } from "@/lib/i18n/server";
import {
  Award,
  FileSearch,
  Flag,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.trust.trust_and_safety"),
    description:
      t("publicPages.trust.skillsetmind_is_built_around_controlled_course"),
    path: "/trust",
  });
}

type TrustLayer = {
  title: string;
  detail: string;
  Icon: LucideIcon;
};



export default async function TrustPage() {
  const { t } = await getServerTranslation();
  const trustLayers: ReadonlyArray<TrustLayer> = [
    {
      title: t("publicPages.trust.verified_professionals"),
      detail: t("publicPages.trust.skillsetmind_verifies_professional_eligibility_before_publication"),
      Icon: FileSearch,
    },
    {
      title: t("publicPages.trust.protected_access"),
      detail: t("publicPages.trust.learning_workspaces_open_only_after_enrollment"),
      Icon: ShieldCheck,
    },
    {
      title: t("publicPages.trust.refund_controls"),
      detail: t("publicPages.trust.7_day_refund_window_plus_progress"),
      Icon: RefreshCcw,
    },
    {
      title: t("publicPages.trust.community_moderation"),
      detail: t("publicPages.trust.course_communities_ship_with_reporting_moderation"),
      Icon: Flag,
    },
    {
      title: t("publicPages.trust.verifiable_credentials"),
      detail: t("publicPages.trust.skillsetmind_verified_certificates_carry_a_public"),
      Icon: Award,
    },
    {
      title: t("publicPages.trust.no_platform_hold_on_creator_money"),
      detail: t("publicPages.trust.buyers_are_charged_on_the_creator"),
      Icon: Receipt,
    },
  ];

  return (
    <PublicPage
      eyebrow={t("publicPages.trust.trust_and_safety")}
      title={t("publicPages.trust.a_marketplace_needs_rules_before_scale")}
      description={t("publicPages.trust.skillsetmind_is_built_around_controlled_course")}
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {trustLayers.map((layer) => {
          const { Icon } = layer;
          return (
            <article
              key={layer.title}
              className="group rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.18)] hover:shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
            >
              <span
                className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-primary)] group-hover:text-[var(--color-base)]"
                aria-hidden="true"
              >
                <Icon size={20} strokeWidth={1.7} />
              </span>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {layer.title}
              </p>
              <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                {layer.detail}
              </p>
            </article>
          );
        })}
      </section>
    </PublicPage>
  );
}

import { Check } from "lucide-react";

import { getServerTranslation } from "@/lib/i18n/server";
import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.about.about"),
    description:
      t("publicPages.about.skillsetmind_is_an_international_platform_for"),
    path: "/about",
  });
}

export default async function AboutPage() {
  const { t } = await getServerTranslation();

  return (
    <PublicPage
      eyebrow={t("publicPages.about.about")}
      title={t("publicPages.about.skillsetmind_is_a_public_home_for")}
      description={t("publicPages.about.skillsetmind_is_where_professional_educators_publish")}
    >
      {/* Uma lista só, com o check dos cartões de /pricing: eram três caixas
          com borda, cada uma com duas ou três palavras, e liam como cartões
          vazios. */}
      <ul className="mt-10 grid gap-3 border-t border-[var(--color-line)] pt-8 sm:grid-cols-3">
        {[t("publicPages.about.professional_programs"), t("publicPages.about.visible_educators"), t("publicPages.about.educators_are_paid_directly")].map((item) => (
          <li key={item} className="flex items-center gap-3 text-base font-semibold text-[var(--color-ink)]">
            <Check aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0 text-[var(--color-primary)]" />
            {item}
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}

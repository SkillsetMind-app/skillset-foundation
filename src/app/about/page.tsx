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
      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {[t("publicPages.about.professional_programs"), t("publicPages.about.visible_educators"), t("publicPages.about.educators_are_paid_directly")].map((item) => (
          <div key={item} className="rounded-[14px] border border-[var(--color-line)] bg-white p-5">
            <p className="text-sm font-semibold text-[var(--color-primary)]">{item}</p>
          </div>
        ))}
      </section>
    </PublicPage>
  );
}

import { getServerTranslation } from "@/lib/i18n/server";
import { InstructorsDirectory } from "@/components/instructors/instructors-directory";
import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("publicPages.instructors.instructors"),
    description:
      t("publicPages.instructors.independent_experts_publishing_reviewed_professional_courses"),
    path: "/instructors",
  });
}

export default async function InstructorsPage() {
  const { t } = await getServerTranslation();

  return (
    <PublicPage
      eyebrow={t("publicPages.instructors.instructors")}
      title={t("publicPages.instructors.learn_from_reviewed_experts")}
      description={t("publicPages.instructors.meet_independent_creators_whose_public_profiles")}
    >
      <InstructorsDirectory />
    </PublicPage>
  );
}

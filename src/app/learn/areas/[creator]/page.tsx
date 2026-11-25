import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// A creator's members area: /learn/areas/@username (or the uid). The database
// decides who sees it: the creator's learners and the creator; everyone else
// goes to the public storefront.
// Tab title and no index, like the other signed-in pages
// (privatePageMetadata assumes the PlatformShell header, which the area does not use).
export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return {
    title: `${t("learn.memberArea.tabTitle")} | ${siteBrand.name}`,
    robots: { index: false, follow: false },
  };
}

export default async function LearnMemberAreaRoute({
  params,
}: {
  params: Promise<{ creator: string }>;
}) {
  const { creator } = await params;
  let ref = creator;
  try {
    ref = decodeURIComponent(creator);
  } catch {
    // Broken encoding: carry on with the raw text, and the database answers null.
  }

  // The brand on the first paint, as in the classroom: no flash of our own logo.
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaHomeView areaRef={ref} brand={brand} />
    </ProtectedSurface>
  );
}

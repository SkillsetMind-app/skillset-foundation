import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// The community for the whole area: /learn/areas/@username/community (and
// .../community/q/<post> with a post open). The database decides who gets in:
// the owner and anyone enrolled in any of their products.
export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return {
    title: `${t("learn.memberArea.communityTitle")} | ${siteBrand.name}`,
    robots: { index: false, follow: false },
  };
}

export default async function LearnMemberAreaCommunityRoute({
  params,
}: {
  params: Promise<{ creator: string; post?: string[] }>;
}) {
  const { creator, post } = await params;
  let ref = creator;
  try {
    ref = decodeURIComponent(creator);
  } catch {
    // Broken encoding: carry on with the raw text, and the database answers null.
  }
  const openPostId = post?.[0] === "q" && post[1] ? post[1] : null;
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaCommunityView areaRef={ref} brand={brand} openPostId={openPostId} />
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// The community of an extra area: /learn/areas/@usuario/slug/community (and
// .../community/q/<post>). The database decides who gets in: the owner and whoever has a
// paid enrollment in a product of this area.
export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return {
    title: `${t("learn.memberArea.communityTitle")} | ${siteBrand.name}`,
    robots: { index: false, follow: false },
  };
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    // Broken encoding: continues with the raw text, and the database answers null.
    return value;
  }
};

export default async function LearnMemberAreaExtraCommunityRoute({
  params,
}: {
  params: Promise<{ criador: string; area: string; post?: string[] }>;
}) {
  const { criador, area, post } = await params;
  const ref = decode(criador);
  const openPostId = post?.[0] === "q" && post[1] ? post[1] : null;
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaCommunityView areaRef={ref} slug={decode(area)} brand={brand} openPostId={openPostId} />
    </ProtectedSurface>
  );
}

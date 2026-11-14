import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// A comunidade de uma área extra: /learn/areas/@usuario/slug/community (e
// .../community/q/<post>). O banco decide quem entra: o dono e quem tem
// matrícula paga em produto desta área.
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
    // Codificação quebrada: segue com o texto cru, e o banco responde null.
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

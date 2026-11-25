import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// An extra area of the creator (Pro: up to 2 beyond the main one):
// /learn/areas/@username/slug. The database decides who sees it: the owner and whoever bought
// a product of THIS area; everyone else goes to the public storefront.
export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return {
    title: `${t("learn.memberArea.tabTitle")} | ${siteBrand.name}`,
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

export default async function LearnMemberAreaExtraRoute({
  params,
}: {
  params: Promise<{ creator: string; area: string }>;
}) {
  const { creator, area } = await params;
  const ref = decode(creator);
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaHomeView areaRef={ref} slug={decode(area)} brand={brand} />
    </ProtectedSurface>
  );
}

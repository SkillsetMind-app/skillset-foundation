import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// Uma área extra do criador (Pro: até 2 além da principal):
// /learn/areas/@usuario/slug. O banco decide quem vê: o dono e quem comprou
// produto DESTA área; o resto vai para a vitrine pública.
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
    // Codificação quebrada: segue com o texto cru, e o banco responde null.
    return value;
  }
};

export default async function LearnMemberAreaExtraRoute({
  params,
}: {
  params: Promise<{ criador: string; area: string }>;
}) {
  const { criador, area } = await params;
  const ref = decode(criador);
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaHomeView areaRef={ref} slug={decode(area)} brand={brand} />
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// A comunidade da área inteira: /learn/areas/@usuario/community (e
// .../community/q/<post> com um post aberto). O banco decide quem entra:
// o dono e quem tem matrícula em qualquer produto dele.
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
  params: Promise<{ criador: string; post?: string[] }>;
}) {
  const { criador, post } = await params;
  let ref = criador;
  try {
    ref = decodeURIComponent(criador);
  } catch {
    // Codificação quebrada: segue com o texto cru, e o banco responde null.
  }
  const openPostId = post?.[0] === "q" && post[1] ? post[1] : null;
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaCommunityView areaRef={ref} brand={brand} openPostId={openPostId} />
    </ProtectedSurface>
  );
}

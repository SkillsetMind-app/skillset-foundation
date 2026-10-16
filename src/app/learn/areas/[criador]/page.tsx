import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import { brand as siteBrand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";
import { getCreatorBrand } from "@/lib/learn/server/member-area";

// A área de membros de um criador: /learn/areas/@usuario (ou o uid). O banco
// decide quem vê: aluno do criador e o próprio criador; o resto vai para a
// vitrine pública.
// Título da aba e nada de índice, como as outras páginas logadas
// (privatePageMetadata pressupõe o cabeçalho da PlatformShell, que a área não usa).
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
  params: Promise<{ criador: string }>;
}) {
  const { criador } = await params;
  let ref = criador;
  try {
    ref = decodeURIComponent(criador);
  } catch {
    // Codificação quebrada: segue com o texto cru, e o banco responde null.
  }

  // A marca no primeiro desenho, como na sala: sem piscar o logo nosso.
  const brand = await getCreatorBrand(ref);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaHomeView areaRef={ref} brand={brand} />
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";

// A área de membros de um criador: /learn/areas/@usuario (ou o uid). O banco
// decide quem vê: aluno do criador e o próprio criador; o resto vai para a
// vitrine pública.
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

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <MemberAreaHomeView areaRef={ref} />
    </ProtectedSurface>
  );
}

import { redirect } from "next/navigation";

// /learn/community/creator?courseId=<id> era o hub de comunidade dos cursos
// publicados por professor — a segunda cara do mesmo feed que a sala de aula
// mostra. Agora a comunidade e a aba "Community" da sala; este endereco so
// encaminha (links antigos do sino e do painel continuam valendo). Sem
// courseId nao ha para onde ir: volta a lista de comunidades.
export default async function LearnCreatorCommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string | string[] }>;
}) {
  const { courseId } = await searchParams;
  const id = Array.isArray(courseId) ? courseId[0] : courseId;

  if (!id) {
    redirect("/learn/community");
  }

  redirect(`/learn/courses/${encodeURIComponent(id)}/community`);
}

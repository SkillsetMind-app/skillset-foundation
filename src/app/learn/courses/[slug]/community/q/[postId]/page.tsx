import { LearnCoursePage } from "@/components/learn/learn-course-page";

export function generateStaticParams() {
  return [];
}

// Uma pergunta (ou qualquer post) da comunidade, com endereco proprio:
// /learn/courses/<curso>/community/q/<post>. Abre como gaveta POR CIMA do
// feed — nao troca de pagina; voltar fecha a gaveta. Compartilhar este link
// abre a mesma pergunta para quem receber.
export default async function LearnCommunityPostRoute({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;

  return <LearnCoursePage slug={slug} tab="community" openPostId={postId} />;
}

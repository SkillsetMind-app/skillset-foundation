import { redirect } from "next/navigation";

export function generateStaticParams() {
  return [];
}

// A comunidade do curso tem UMA cara: a aba "Community" da sala de aula, no
// tema do curso, com a aula atual no endereco e um caminho de volta. Esta
// pagina era a segunda cara — o mesmo feed num hub separado, com manchete
// grande, outra moldura, e sem volta para a aula. Pior: ela lia um espaco com
// outra chave (community-<slug>), nao o que a sala usa. Links antigos (sino,
// barra lateral, favoritos) continuam funcionando: caem aqui e seguem.
export default async function LearnCommunityCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  redirect(`/learn/courses/${encodeURIComponent(slug)}/community`);
}

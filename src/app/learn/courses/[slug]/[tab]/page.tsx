import { notFound } from "next/navigation";

import { LearnCoursePage } from "@/components/learn/learn-course-page";
import { isClassroomTab } from "@/domain/classroom-tabs";

export function generateStaticParams() {
  return [];
}

// Uma aba da sala com endereco proprio: /learn/courses/<curso>/community,
// /materials, /messages, /review, /about, /lives. Antes tudo isso morava na
// mesma rolagem da aula, sem endereco — nao dava para compartilhar nem voltar.
// A aula em si e a rota-mae (sem segmento); "/lesson" nao existe.
export default async function LearnCourseTabRoute({
  params,
}: {
  params: Promise<{ slug: string; tab: string }>;
}) {
  const { slug, tab } = await params;

  if (!isClassroomTab(tab) || tab === "lesson") {
    notFound();
  }

  return <LearnCoursePage slug={slug} tab={tab} />;
}

import { LearnCoursePage } from "@/components/learn/learn-course-page";
import { getCourseSlugs } from "@/lib/data/catalog";

export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

// A aula. As demais abas da sala (materials, community, messages...) sao a
// rota irma [tab]/page.tsx — mesma pagina, endereco proprio.
export default async function LearnCourseLessonRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <LearnCoursePage slug={slug} tab="lesson" />;
}

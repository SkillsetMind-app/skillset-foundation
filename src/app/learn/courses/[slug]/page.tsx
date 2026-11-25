import { LearnCoursePage } from "@/components/learn/learn-course-page";
import { getCourseSlugs } from "@/lib/data/catalog";

export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

// The lesson. The other classroom tabs (materials, community, messages...) are
// the sibling route [tab]/page.tsx — same page, its own address.
export default async function LearnCourseLessonRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <LearnCoursePage slug={slug} tab="lesson" />;
}

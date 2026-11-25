import { notFound } from "next/navigation";

import { LearnCoursePage } from "@/components/learn/learn-course-page";
import { isClassroomTab } from "@/domain/classroom-tabs";

// A classroom tab with its own address: /learn/courses/<course>/community,
// /materials, /messages, /review, /about, /lives. Before, all of this lived in
// the same scroll as the lesson, with no address — it could not be shared or
// gone back to. The lesson itself is the parent route (no segment); "/lesson"
// does not exist.
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

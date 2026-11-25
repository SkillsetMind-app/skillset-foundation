import { redirect } from "next/navigation";

// The course community has ONE face: the "Community" tab of the classroom, in
// the course theme, with the current lesson in the address and a way back. This
// page was the second face — the same feed in a separate hub, with a big
// headline, a different frame, and no way back to the lesson. Worse: it read a
// space under a different key (community-<slug>), not the one the classroom
// uses. Old links (bell, sidebar, favorites) keep working: they land here and
// move on.
export default async function LearnCommunityCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  redirect(`/learn/courses/${encodeURIComponent(slug)}/community`);
}

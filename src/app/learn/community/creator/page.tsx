import { redirect } from "next/navigation";

// /learn/community/creator?courseId=<id> was the community hub for the courses
// published by a teacher — the second face of the same feed the classroom
// shows. Now the community is the "Community" tab of the classroom; this
// address only redirects (old links from the bell and the dashboard still
// work). With no courseId there is nowhere to go: back to the list of
// communities.
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

import { LearnCoursePage } from "@/components/learn/learn-course-page";

// A question (or any post) in the community, with its own address:
// /learn/courses/<course>/community/q/<post>. It opens as a drawer OVER the
// feed — it does not change page; going back closes the drawer. Sharing this
// link opens the same question for whoever receives it.
export default async function LearnCommunityPostRoute({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;

  return <LearnCoursePage slug={slug} tab="community" openPostId={postId} />;
}

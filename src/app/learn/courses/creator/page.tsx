import { redirect } from "next/navigation";

/**
 * Compatibility redirect, mirroring `/courses/creator` (src/app/courses/creator/page.tsx).
 * The canonical member area is `/learn/courses/[slug]`, which already resolves
 * teacher-published courses by id through its CreatorCourseWorkspace branch.
 * This route used to render that same workspace inside PlatformShell, so it was
 * a second copy of the member area wearing the dashboard rail — the exact
 * "two layouts mixed" problem PR #21 removed from the canonical route. Nothing
 * in src/ links here anymore, so we collapse it instead of keeping two shells
 * in sync: forward to the canonical member area when a courseId is present,
 * otherwise back to the learning dashboard.
 */
export default async function LearnCreatorCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string | string[] }>;
}) {
  const { courseId: raw } = await searchParams;
  const courseId = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  redirect(courseId ? `/learn/courses/${encodeURIComponent(courseId)}` : "/learn");
}

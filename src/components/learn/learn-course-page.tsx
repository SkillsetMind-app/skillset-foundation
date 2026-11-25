import { getServerTranslation } from "@/lib/i18n/server";
import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import { getCourseBySlug } from "@/lib/data/catalog";
import { getMemberArea } from "@/lib/learn/server/member-area";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";

// The classroom page, shared by two routes:
//   /learn/courses/[slug]         -> tab "lesson"
//   /learn/courses/[slug]/[tab]   -> materials | lives | community | ...
// Before, only the first existed and everything lived in the same scroll. The logic of
// "static catalog vs course published by a teacher" is the same in both; that is
// why it lives here and not in each route file.
export async function LearnCoursePage({
  slug,
  tab,
  openPostId = null,
}: {
  slug: string;
  tab: ClassroomTab;
  /** A community post opened in the drawer (route .../community/q/<post>). */
  openPostId?: string | null;
}) {
  const { t } = await getServerTranslation();
  const course = getCourseBySlug(slug);
  // This route's classroom: the top Help sends the lesson question here.
  const classroomHref = `/learn/courses/${encodeURIComponent(slug)}`;

  if (!course) {
    const { brand, theme, communityEnabled } = await getMemberArea(slug);

    return (
      <ProtectedSurface permissions={["courses.viewLearning"]}>
        {/* Same member area as the catalog branch below. getCourseBySlug only
            matches the static demo catalog, so every teacher-published course
            lands here — this is the live path (Stripe success_url, "Continue"
            on the dashboard), not a fallback. It has to open in the member
            shell too, or the dashboard rail comes back for real students. */}
        <MemberAreaShell brand={brand} theme={theme} course={{ href: classroomHref, communityEnabled }}>
          <Suspense
            fallback={
              // The classroom's one loading state (same as the route file and
              // the workspaces), here in the course's own --ma-* colours. The
              // server does not read the address here: the same short form as the
              // route file (loading.tsx explains the choice).
              <ClassroomLoading label={t("learnWave2.courseLoading.title")} short />
            }
          >
            <CreatorCourseWorkspace
              initialCourseId={slug}
              whitelabel={Boolean(brand)}
              tab={tab}
              openPostId={openPostId}
            />
          </Suspense>
        </MemberAreaShell>
      </ProtectedSurface>
    );
  }

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      {/* COURSE_VIEWED — fired on mount of the enrolled course route.
          source="direct" because we can't infer marketing source here;
          referrer-based source resolution happens in PostHog itself via
          $referrer/$referring_domain on the same session. */}
      <CourseViewedTracker
        course_id={course.id}
        slug={course.slug}
        source="direct"
      />
      {/* Static demo catalog: the course record is already in hand, so the
          theme comes straight off it — no round trip, and shell and classroom
          card read the same value. */}
      <MemberAreaShell
        theme={course.membersTheme ?? "light"}
        course={{ href: classroomHref, communityEnabled: Boolean(course.communityEnabled) }}
      >
        <EnrolledCourseWorkspace course={course} tab={tab} openPostId={openPostId} />
      </MemberAreaShell>
    </ProtectedSurface>
  );
}

import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import { getCourseBySlug } from "@/lib/data/catalog";
import { getMemberArea } from "@/lib/learn/server/member-area";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";

// A pagina da sala de aula, compartilhada por duas rotas:
//   /learn/courses/[slug]         -> tab "lesson"
//   /learn/courses/[slug]/[tab]   -> materials | lives | community | ...
// Antes so a primeira existia e tudo morava na mesma rolagem. A logica de
// "catalogo estatico vs curso publicado por professor" e a mesma nas duas; por
// isso vive aqui e nao em cada arquivo de rota.
export async function LearnCoursePage({
  slug,
  tab,
  openPostId = null,
}: {
  slug: string;
  tab: ClassroomTab;
  /** Um post da comunidade aberto na gaveta (rota .../community/q/<post>). */
  openPostId?: string | null;
}) {
  const course = getCourseBySlug(slug);

  if (!course) {
    const { brand, theme } = await getMemberArea(slug);

    return (
      <ProtectedSurface permissions={["courses.viewLearning"]}>
        {/* Same member area as the catalog branch below. getCourseBySlug only
            matches the static demo catalog, so every teacher-published course
            lands here — this is the live path (Stripe success_url, "Continue"
            on the dashboard), not a fallback. It has to open in the member
            shell too, or the dashboard rail comes back for real students. */}
        <MemberAreaShell brand={brand} theme={theme}>
          <Suspense
            fallback={
              // Members tokens, not platform ones: this fallback paints inside
              // the themed shell, and a white card on the dark bg reads as a
              // flash of the wrong product.
              <section className="rounded-[14px] border border-[var(--ma-line)] bg-[var(--ma-surface)] p-6">
                <p className="text-sm text-[var(--ma-ink-soft)]">
                  Loading creator course...
                </p>
              </section>
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
      <MemberAreaShell theme={course.membersTheme ?? "light"}>
        <EnrolledCourseWorkspace course={course} tab={tab} openPostId={openPostId} />
      </MemberAreaShell>
    </ProtectedSurface>
  );
}

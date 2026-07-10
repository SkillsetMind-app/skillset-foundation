import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getCourseBySlug, getCourseSlugs } from "@/lib/data/catalog";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";

export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

export default async function LearnCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getCourseBySlug(slug);

  if (!course) {
    return (
      <ProtectedSurface permissions={["courses.viewLearning"]}>
        <PlatformShell
          eyebrow="Private creator course"
          title="Teacher-published course workspace."
          description="Your enrolled course opens here once your access is confirmed."
        >
          <Suspense
            fallback={
              <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
                <p className="text-sm text-[var(--color-ink-soft)]">
                  Loading creator course...
                </p>
              </section>
            }
          >
            <CreatorCourseWorkspace initialCourseId={slug} />
          </Suspense>
        </PlatformShell>
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
      <PlatformShell
        eyebrow="Member area"
        title="Course member area"
        description="Lessons, materials, progress, and community activity for this enrolled course."
        hideHeader
      >
        <EnrolledCourseWorkspace course={course} />
      </PlatformShell>
    </ProtectedSurface>
  );
}

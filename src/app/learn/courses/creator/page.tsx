import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { PlatformShell } from "@/components/platform/platform-shell";

export default function LearnCreatorCoursePage() {
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
          <CreatorCourseWorkspace />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

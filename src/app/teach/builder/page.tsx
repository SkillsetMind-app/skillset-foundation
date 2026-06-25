import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherBuilderHub } from "@/components/teacher/teacher-builder-hub";

export default function TeacherBuilderPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        eyebrow="Course builder"
        title="Course Builder."
        description="Create courses, manage drafts, configure modules, upload lessons and materials, and submit for Skillset review."
      >
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                Loading course builder...
              </p>
            </section>
          }
        >
          <TeacherBuilderHub />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CoursePreviewShell } from "@/components/teacher/course-preview-shell";

type TeacherBuilderPreviewPageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export default async function TeacherBuilderPreviewPage({
  params,
}: TeacherBuilderPreviewPageProps) {
  const { courseId } = await params;

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        eyebrow="Course preview"
        title="Preview the members area."
        description="Inspect the student-facing course workspace before publishing changes."
      >
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                Loading course preview...
              </p>
            </section>
          }
        >
          <CoursePreviewShell courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

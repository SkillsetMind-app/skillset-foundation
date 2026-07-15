import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";

type CourseManagePageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export default async function CourseManagePage({
  params,
}: CourseManagePageProps) {
  const { courseId } = await params;

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title="Course management" hideHeader>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                Loading course management...
              </p>
            </section>
          }
        >
          <CourseManageHub key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

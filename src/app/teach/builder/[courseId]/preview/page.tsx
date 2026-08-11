import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { CoursePreviewShell } from "@/components/teacher/course-preview-shell";
import { getMemberArea } from "@/lib/learn/server/member-area";

type TeacherBuilderPreviewPageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export default async function TeacherBuilderPreviewPage({
  params,
}: TeacherBuilderPreviewPageProps) {
  const { courseId } = await params;
  // Same lookup the student route runs, from the same module — the teacher has
  // to see exactly what a student sees.
  const { brand, theme } = await getMemberArea(courseId);

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      {/* MemberAreaShell, not PlatformShell: the teacher has to see the exact
          surface a student gets — dark members theme, their own mark, no
          platform sidebar or page heading wrapped around it. */}
      <MemberAreaShell brand={brand} theme={theme}>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--ma-line)] bg-[var(--ma-surface)] p-6">
              <p className="text-sm text-[var(--ma-ink-soft)]">
                Loading course preview...
              </p>
            </section>
          }
        >
          <CoursePreviewShell courseId={courseId} whitelabel={Boolean(brand)} />
        </Suspense>
      </MemberAreaShell>
    </ProtectedSurface>
  );
}

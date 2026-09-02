import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherCommunityInbox } from "@/components/teacher/teacher-community-inbox";

type CourseCommunityPageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

// Para o professor a comunidade e uma caixa de entrada: o que espera resposta
// no topo, respondido ali mesmo; o resto em cartoes curtos (mockup 5, 11d).
export default async function CourseCommunityPage({
  params,
}: CourseCommunityPageProps) {
  const { courseId } = await params;

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title="Community" hideHeader>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">Loading community...</p>
            </section>
          }
        >
          <TeacherCommunityInbox key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

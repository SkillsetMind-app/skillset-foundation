import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherCommunityInbox } from "@/components/teacher/teacher-community-inbox";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teacherCommunity.title");
}

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
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title={t("teacherCommunity.title")} hideHeader>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">{t("teacherCommunity.loading")}</p>
            </section>
          }
        >
          <TeacherCommunityInbox key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

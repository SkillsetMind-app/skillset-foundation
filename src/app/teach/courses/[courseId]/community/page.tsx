import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { BuilderSkeleton } from "@/components/teacher/builder-skeleton";
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
        {/* O mesmo esqueleto da caixa de entrada enquanto ela lê o curso: antes
            a frase saía de um cartão e reaparecia solta, sem cartão. */}
        <Suspense
          fallback={<BuilderSkeleton label={t("teacherCommunity.loading")} />}
        >
          <TeacherCommunityInbox key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

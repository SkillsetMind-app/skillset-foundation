import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { BuilderSkeleton, ProductListSkeleton } from "@/components/teacher/builder-skeleton";
import { TeacherBuilderHub } from "@/components/teacher/teacher-builder-hub";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.courseBuilder");
}

export default async function TeacherBuilderPage({
  searchParams,
}: {
  searchParams?: Promise<{ courseId?: string | string[] }>;
} = {}) {
  const { t } = await getServerTranslation();
  // Sem curso, esta rota é a lista de produtos: o esqueleto tem a forma dela.
  const courseId = (await searchParams)?.courseId;
  const label = t("creatorEditor.builder.shell.loading");
  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        title={t("platform.nav.courseBuilder")}
        hideHeader
      >
        <Suspense
          fallback={courseId ? <BuilderSkeleton label={label} /> : <ProductListSkeleton label={label} />}
        >
          <TeacherBuilderHub />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

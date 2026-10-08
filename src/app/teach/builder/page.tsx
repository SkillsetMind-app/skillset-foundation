import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { BuilderSkeleton } from "@/components/teacher/builder-skeleton";
import { TeacherBuilderHub } from "@/components/teacher/teacher-builder-hub";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.courseBuilder");
}

export default async function TeacherBuilderPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        title={t("platform.nav.courseBuilder")}
        hideHeader
      >
        <Suspense
          fallback={<BuilderSkeleton label={t("creatorEditor.builder.shell.loading")} />}
        >
          <TeacherBuilderHub />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
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
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.shell.loading")}
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

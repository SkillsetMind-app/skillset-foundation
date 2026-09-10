import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { getServerTranslation } from "@/lib/i18n/server";

type CourseManagePageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export default async function CourseManagePage({
  params,
}: CourseManagePageProps) {
  const { courseId } = await params;
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title={t("creatorPanel.hub.header.eyebrow")} hideHeader>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("teacherRouteResidual.manageLoading")}
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

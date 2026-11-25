import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { BuilderSkeleton } from "@/components/teacher/builder-skeleton";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("creatorPanel.hub.header.eyebrow");
}

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
        {/* The same skeleton the hub shows while it reads the course: before there were
            two cards in a row, each with a sentence ("Loading course
            management..." and then "Loading course..."). */}
        <Suspense
          fallback={<BuilderSkeleton label={t("teacherRouteResidual.manageLoading")} />}
        >
          <CourseManageHub key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

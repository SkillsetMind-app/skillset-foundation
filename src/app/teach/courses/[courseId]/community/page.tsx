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

// For the teacher the community is an inbox: what awaits an answer
// on top, answered right there; the rest in short cards (mockup 5, 11d).
export default async function CourseCommunityPage({
  params,
}: CourseCommunityPageProps) {
  const { courseId } = await params;
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title={t("teacherCommunity.title")} hideHeader>
        {/* The same skeleton as the inbox while it reads the course: before,
            the sentence came out of a card and reappeared loose, with no card. */}
        <Suspense
          fallback={<BuilderSkeleton label={t("teacherCommunity.loading")} />}
        >
          <TeacherCommunityInbox key={courseId} courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

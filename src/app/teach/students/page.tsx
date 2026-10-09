import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherStudentsList } from "@/components/teacher/teacher-students-list";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.students");
}

export default async function TeacherStudentsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        title={t("platform.nav.students")}
        description={t("teach.studentsPage.description")}
        compact
      >
        <TeacherStudentsList />
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherMembersAreaHub } from "@/components/teacher/teacher-members-area-hub";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function TeacherMembersPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title={t("teacherMembers.pageTitle")} hideHeader>
        <TeacherMembersAreaHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

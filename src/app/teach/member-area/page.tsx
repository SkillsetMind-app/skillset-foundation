import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { MemberAreaSettingsPanel } from "@/components/teacher/member-area-settings-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.memberAreaPage.title");
}

export default async function TeacherMemberAreaPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        eyebrow={t("teach.page.eyebrow")}
        title={t("teach.memberAreaPage.title")}
        description={t("teach.memberAreaPage.description")}
      >
        <MemberAreaSettingsPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}

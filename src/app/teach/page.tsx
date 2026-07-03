import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function TeachPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("teach.page.eyebrow")}
        title={t("teach.page.title")}
        description={t("teach.page.description")}
        hideHeader
      >
        <TeacherStudioDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}

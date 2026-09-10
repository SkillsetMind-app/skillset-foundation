import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.team");
}

export default async function TeacherTeamPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("platform.nav.team")} hideHeader>
        <TeacherComingSoonPanel
          eyebrow={t("teach.page.eyebrow")}
          title={t("teach.teamPage.title")}
          description={t("teach.teamPage.description")}
          notifyFeature={t("platform.nav.team")}
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

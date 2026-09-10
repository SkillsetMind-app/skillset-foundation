import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.integrations");
}

export default async function TeacherIntegrationsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("platform.nav.integrations")} hideHeader>
        <TeacherComingSoonPanel
          eyebrow={t("teach.page.eyebrow")}
          title={t("teach.integrationsPage.title")}
          description={t("teach.integrationsPage.description")}
          primaryHref="/account/payments"
          primaryLabel={t("platform.nav.payoutsTax")}
          notifyFeature={t("platform.nav.integrations")}
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

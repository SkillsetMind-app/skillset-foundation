import { PlatformShell } from "@/components/platform/platform-shell";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function LearnPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow={t("learn.page.eyebrow")}
        title={t("learn.page.title")}
        description={t("learn.page.description")}
      >
        <LearnDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}

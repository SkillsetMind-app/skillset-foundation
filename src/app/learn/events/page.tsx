import { getServerTranslation } from "@/lib/i18n/server";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnEventsHub } from "@/components/learn/learn-events-hub";
import { PlatformShell } from "@/components/platform/platform-shell";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learnWave2.events.title");
}

export default async function LearnEventsPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow={t("learnWave2.events.eyebrow")}
        title={t("learnWave2.events.title")}
        description={t("learnWave2.events.description")}
      >
        <LearnEventsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

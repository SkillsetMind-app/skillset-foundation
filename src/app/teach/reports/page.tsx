import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.reportsPage.title");
}

/**
 * Hotmart-parity "Relatórios" entry: sales + recurrence rollup.
 * Reuses CreatorOpsHub metrics (orders, MRR, recorded earnings) until dedicated charts ship.
 * The header comes from the dictionary: fixed in English, it showed in English with the
 * interface in Spanish (visual QA in production, Sep 8).
 */
export default async function TeacherReportsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        title={t("teach.reportsPage.title")}
        description={t("teach.reportsPage.description")}
      >
        <CreatorOpsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

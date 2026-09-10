import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.reportsPage.title");
}

/**
 * Hotmart-parity "Relatórios" entry: sales + recurrence rollup.
 * Reuses CreatorOpsHub metrics (orders, MRR, recorded earnings) until dedicated charts ship.
 * O cabecalho vem do dicionario: fixo em ingles, aparecia em ingles com a
 * interface em espanhol (QA visual em producao, 08/09).
 */
export default async function TeacherReportsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("teach.reportsPage.eyebrow")}
        title={t("teach.reportsPage.title")}
        description={t("teach.reportsPage.description")}
      >
        <CreatorOpsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

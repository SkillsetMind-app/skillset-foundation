import { PlatformShell } from "@/components/platform/platform-shell";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function LearnPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      {/* hideHeader: o aluno via duas boas-vindas seguidas, a manchete do
          shell e o "Welcome back" do painel logo abaixo. O painel passa a
          emitir a unica saudacao (e o unico h1), como o estudio do professor. */}
      <PlatformShell
        eyebrow={t("learn.page.eyebrow")}
        title={t("learn.page.title")}
        description={t("learn.page.description")}
        hideHeader
      >
        <LearnDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}

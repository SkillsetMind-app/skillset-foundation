import { PlatformShell } from "@/components/platform/platform-shell";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learn.page.title");
}

export default async function LearnPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      {/* hideHeader: o painel emite a unica saudacao (e o unico h1). O titulo
          da casca so nomeia a aba do navegador: "My courses", como o menu —
          nao mais "Your learning, in one place." com o selo de marketing
          "Student experience". */}
      <PlatformShell title={t("learn.page.title")} hideHeader>
        <LearnDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}

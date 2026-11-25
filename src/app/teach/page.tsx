import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";
import { getServerStudioSeed } from "@/lib/data/server/studio-home";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.page.title");
}

export default async function TeachPage() {
  // Products and publish gates come with the page: "Next steps" and "My
  // products" are in the first HTML, where they will stay, instead of arriving
  // after reads from the browser and pushing the page down.
  const [{ t }, seed] = await Promise.all([getServerTranslation(), getServerStudioSeed()]);

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        title={t("teach.page.title")}
        description={t("teach.page.description")}
        hideHeader
      >
        <TeacherStudioDashboard seed={seed} />
      </PlatformShell>
    </ProtectedSurface>
  );
}

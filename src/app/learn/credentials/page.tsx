import { getServerTranslation } from "@/lib/i18n/server";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnCredentialsHub } from "@/components/learn/learn-credentials-hub";
import { PlatformShell } from "@/components/platform/platform-shell";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learnWave2.credentialsPage.title");
}

export default async function LearnCredentialsPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["certificates.view"]}>
      <PlatformShell
        eyebrow={t("learnWave2.credentialsPage.eyebrow")}
        title={t("learnWave2.credentialsPage.title")}
        description={t("learnWave2.credentialsPage.description")}
      >
        <LearnCredentialsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

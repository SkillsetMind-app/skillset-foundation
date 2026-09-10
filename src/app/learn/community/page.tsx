import { getServerTranslation } from "@/lib/i18n/server";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnCommunityHub } from "@/components/learn/learn-community-hub";
import { PlatformShell } from "@/components/platform/platform-shell";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learnWave2.community.title");
}

export default async function LearnCommunityPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["community.read"]}>
      <PlatformShell
        eyebrow={t("learnWave2.community.eyebrow")}
        title={t("learnWave2.community.title")}
        description={t("learnWave2.community.description")}
      >
        <LearnCommunityHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

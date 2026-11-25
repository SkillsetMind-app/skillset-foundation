import { LoadingScreen } from "@/components/auth/loading-screen";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: t("appErrors.preparingMetadataTitle"),
    robots: { index: false, follow: false },
  };
}

export default function LoadingPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoadingScreen />
    </Suspense>
  );
}

// Same screen and same phrase as the LoadingScreen that takes its place: the
// switch from server to client is not visible.
async function LoadingFallback() {
  const { t } = await getServerTranslation();
  return <SkillsetSpinner title={t("authFlow.loading.title")} />;
}

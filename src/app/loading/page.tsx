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

// Mesma tela e mesma frase do LoadingScreen que entra no lugar dela: a troca
// do servidor para o cliente não aparece.
async function LoadingFallback() {
  const { t } = await getServerTranslation();
  return <SkillsetSpinner title={t("authFlow.loading.title")} />;
}

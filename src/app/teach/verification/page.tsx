import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CardPageSkeleton } from "@/components/teacher/builder-skeleton";
import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("professionalBadge.title");
}

export default async function CreatorVerificationPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("professionalBadge.title")} hideHeader>
        <Suspense
          fallback={
            // A forma da tela (titulo e cartao), na mesma coluna do painel:
            // antes era um cartao com uma frase, trocado por outro cartao.
            // Alinhada a esquerda, como o painel desde o T-01 (sem mx-auto).
            <div className="w-full max-w-3xl">
              <CardPageSkeleton label={t("professionalBadge.loading")} />
            </div>
          }
        >
          <CreatorVerificationPanel />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

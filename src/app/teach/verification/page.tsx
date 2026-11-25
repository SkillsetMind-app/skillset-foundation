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
            // The shape of the screen (title and card), in the same column as the dashboard:
            // before it was a card with one sentence, swapped for another card.
            // Left-aligned, like the dashboard since T-01 (no mx-auto).
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

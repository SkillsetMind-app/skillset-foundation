import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

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
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("professionalBadge.loading")}
              </p>
            </section>
          }
        >
          <CreatorVerificationPanel />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

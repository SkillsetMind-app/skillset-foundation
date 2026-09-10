import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("activationCheckout.pageTitle");
}

export default async function TeachActivatePage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.pageTitle")} compact>
        <Suspense
          fallback={
            <div className="rounded-[14px] border fine-rule bg-white p-8 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)]">
              {t("activationCheckout.preparing")}
            </div>
          }
        >
          <ActivationCheckoutPanel />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

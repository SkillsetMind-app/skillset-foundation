import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { uuidPattern } from "@/lib/operations/http";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("activationCheckout.pageTitle");
}

export default async function TeachActivatePage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { t } = await getServerTranslation();
  // The builder's "Activate and publish" sends the course along; only a course
  // id shape travels on to checkout.
  const requested = (await searchParams)?.courseId;
  const courseId = typeof requested === "string" && uuidPattern.test(requested) ? requested : null;
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.pageTitle")} compact>
        <Suspense
          fallback={
            <div className="rounded-none border fine-rule bg-white p-8 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)]">
              {t("activationCheckout.preparing")}
            </div>
          }
        >
          <ActivationCheckoutPanel courseId={courseId} />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

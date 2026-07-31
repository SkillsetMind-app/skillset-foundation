import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";

export default function TeachActivatePage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Activate your storefront" compact>
        <Suspense
          fallback={
            <div className="rounded-[14px] border fine-rule bg-white p-8 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)]">
              Preparing secure checkout…
            </div>
          }
        >
          <ActivationCheckoutPanel />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

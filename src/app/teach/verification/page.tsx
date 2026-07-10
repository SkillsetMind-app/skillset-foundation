import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";

export default function CreatorVerificationPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Professional verification" hideHeader>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                Loading verification...
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

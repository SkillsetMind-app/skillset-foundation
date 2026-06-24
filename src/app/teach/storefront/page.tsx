import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { StorefrontSettingsPanel } from "@/components/teacher/storefront-settings-panel";

export default function TeacherStorefrontPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.manageStorefront"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Your storefront."
        description="Brand the public page that showcases you and every course you publish."
      >
        <StorefrontSettingsPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}

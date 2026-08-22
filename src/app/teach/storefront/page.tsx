import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CustomDomainsPanel } from "@/components/teacher/custom-domains-panel";
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
        {/* Below the branding panel on purpose: a teacher decides what the page
            looks like before they decide what address it answers on. */}
        <CustomDomainsPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}

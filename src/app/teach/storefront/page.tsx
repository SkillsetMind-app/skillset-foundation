import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CustomDomainsPanel } from "@/components/teacher/custom-domains-panel";
import { StorefrontSettingsPanel } from "@/components/teacher/storefront-settings-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.storefrontPage.title");
}

export default async function TeacherStorefrontPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageStorefront"]}>
      <PlatformShell
        eyebrow={t("teach.page.eyebrow")}
        title={t("teach.storefrontPage.title")}
        description={t("teach.storefrontPage.description")}
      >
        <StorefrontSettingsPanel />
        {/* Below the branding panel on purpose: a teacher decides what the page
            looks like before they decide what address it answers on. */}
        <CustomDomainsPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}

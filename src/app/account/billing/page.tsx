import { BillingTabs } from "@/components/account/billing-tabs";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("accountBillingPage.title");
}

export default async function AccountBillingPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        eyebrow={t("accountBillingPage.eyebrow")}
        title={t("accountBillingPage.title")}
        description={t("accountBillingPage.description")}
        compact
      >
        <BillingTabs />
      </PlatformShell>
    </ProtectedSurface>
  );
}

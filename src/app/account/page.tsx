import { Suspense } from "react";

import { AccountSettingsHub } from "@/components/account/account-settings-hub";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("accountSettings.label");
}

export default async function AccountPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        title={t("accountSettings.label")}
        description={t("accountSettings.description")}
        compact
        hideHeader
      >
        <Suspense fallback={<SettingsFallback />}>
          <AccountSettingsHub />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

function SettingsFallback() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-40 animate-pulse rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-strong)]" />
      <div className="h-64 animate-pulse rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface-strong)]" />
    </div>
  );
}

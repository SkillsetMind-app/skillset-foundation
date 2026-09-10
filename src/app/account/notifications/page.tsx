import { NotificationsInbox } from "@/components/account/notifications-inbox";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function AccountNotificationsPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        title={t("accountNotifications.title")}
        description={t("accountNotifications.description")}
      >
        <NotificationsInbox />
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { NotificationsInbox } from "@/components/account/notifications-inbox";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

export default function AccountNotificationsPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        title="Notifications"
        description="Replies, reviews, and enrollment updates across your account."
      >
        <NotificationsInbox />
      </PlatformShell>
    </ProtectedSurface>
  );
}

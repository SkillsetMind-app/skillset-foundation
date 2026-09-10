import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SupportTicketCenter } from "@/components/support/support-ticket-center";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function SupportPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        eyebrow={t("supportCenter.eyebrow")}
        title={t("supportCenter.pageTitle")}
        description={t("supportCenter.pageDescription")}
      >
        <SupportTicketCenter />
      </PlatformShell>
    </ProtectedSurface>
  );
}

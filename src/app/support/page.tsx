import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { WhatsAppContact } from "@/components/site/whatsapp-contact";
import { SupportTicketCenter } from "@/components/support/support-ticket-center";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function SupportPage() {
  const { t } = await getServerTranslation();
  return (
    // Signed out, the sign-in wall points to /contact: whoever cannot sign in
    // is exactly who needs support, and that page works without an account.
    <ProtectedSurface permissions={["auth.signOut"]} contactWhenSignedOut>
      <PlatformShell
        eyebrow={t("supportCenter.eyebrow")}
        title={t("supportCenter.pageTitle")}
        description={t("supportCenter.pageDescription")}
      >
        <WhatsAppContact t={t} className="mb-4" />
        <SupportTicketCenter />
      </PlatformShell>
    </ProtectedSurface>
  );
}

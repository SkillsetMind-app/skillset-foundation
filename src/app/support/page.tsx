import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SupportTicketCenter } from "@/components/support/support-ticket-center";

export default function SupportPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        eyebrow="Support"
        title="Get help without leaving the platform."
        description="Create support tickets for account, course, payment, or technical issues. The Skillset support team reviews every ticket and replies on this page."
      >
        <SupportTicketCenter />
      </PlatformShell>
    </ProtectedSurface>
  );
}

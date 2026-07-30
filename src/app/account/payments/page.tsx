import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";

export default function AccountPaymentsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        title="Payouts & tax"
        description="Creator money only: Stripe Connect status, sales, earnings, refunds, and statements. Buyers pay your Stripe account directly — SkillsetMind never holds your money and adds no clearing period of its own. Payout timing is Stripe's, and depends on your country, payment method, and your Stripe account's payout schedule. Profile and security settings stay in Settings."
        compact
      >
        <TeacherWalletPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}

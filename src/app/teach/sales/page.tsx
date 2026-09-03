import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SaleList } from "@/components/teacher/sale-list";
import { StripeConnectNotice } from "@/components/teacher/stripe-connect-notice";

export default function TeacherSalesPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Your sales."
        description="Every paid order for your courses. Buyers pay your Stripe account directly — SkillsetMind never holds the money, so this is your record of what sold."
      >
        <StripeConnectNotice />
        <SaleList />
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { BillingTabs } from "@/components/account/billing-tabs";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

export default function AccountBillingPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        eyebrow="Billing & receipts"
        title="What you've paid Skillset."
        description="Course purchases stay accessible for life, and every receipt is downloadable. Subscription billing and payment methods live in your secure Stripe portal. Creator payouts are under Payouts."
        compact
      >
        <BillingTabs />
      </PlatformShell>
    </ProtectedSurface>
  );
}

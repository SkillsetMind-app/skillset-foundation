import { BillingTabs } from "@/components/account/billing-tabs";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

export default function AccountBillingPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        eyebrow="Billing & receipts"
        title="Your purchases and receipts."
        description="Each course is sold by the educator who publishes it — their Stripe account takes the payment, so their name may be what you see on your card statement. One-time course purchases stay accessible for as long as you keep them; subscription courses run while the subscription is active. Your SkillsetMind plan, payment methods, and invoices live in your secure Stripe portal. Creator payouts are under Payouts."
        compact
      >
        <BillingTabs />
      </PlatformShell>
    </ProtectedSurface>
  );
}

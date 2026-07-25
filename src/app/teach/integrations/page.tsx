import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";

export default function TeacherIntegrationsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Integrations" hideHeader>
        <TeacherComingSoonPanel
          eyebrow="Teacher Studio"
          title="Integrations are on the roadmap."
          description="Connect email tools, webhooks, and analytics destinations — it's on the SkillsetMind roadmap. Stripe is already connected, so you can open your own Stripe account from Payouts & tax anytime."
          primaryHref="/account/payments"
          primaryLabel="Open Payouts & tax"
          notifyFeature="Integrations"
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

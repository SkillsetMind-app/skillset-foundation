import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";

/**
 * Hotmart-parity "Relatórios" entry: sales + recurrence rollup.
 * Reuses CreatorOpsHub metrics (orders, MRR, recorded earnings) until dedicated charts ship.
 */
export default function TeacherReportsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Reports."
        description="Sales, recurring revenue, and recorded earnings at a glance. Every charge was created on your own Stripe account — SkillsetMind never holds it. Stripe's own settlement and payout timing then applies."
      >
        <CreatorOpsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

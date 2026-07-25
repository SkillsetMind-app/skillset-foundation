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
        description="Sales, recurring revenue, and recorded earnings at a glance. The money itself is already in your own Stripe balance — SkillsetMind never holds it."
      >
        <CreatorOpsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

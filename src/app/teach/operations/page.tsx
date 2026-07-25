import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";

export default function TeacherOperationsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Operations."
        description="Sales, recurring revenue, earnings, and growth tools in one place."
      >
        <CreatorOpsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

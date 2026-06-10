import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

export default function TeachPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Build, ship, get paid."
        description="Draft a course, prepare the learner experience, and submit when ready. Your course goes on sale as soon as you submit, and Skillset review follows without blocking sales."
        hideHeader
      >
        <TeacherStudioDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";

export default function TeacherTeamPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Team & roles" hideHeader>
        <TeacherComingSoonPanel
          eyebrow="Teacher Studio"
          title="Team & roles are on the roadmap."
          description="Invite teammates, assign editor or analyst roles, and share a course catalog across a team — it's on the Skillset roadmap. Today, each Teacher Studio belongs to a single account."
          notifyFeature="Team & roles"
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

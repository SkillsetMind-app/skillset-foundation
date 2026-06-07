import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";

export default function TeacherCoProductionsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Co-productions" hideHeader>
        <TeacherComingSoonPanel
          eyebrow="Teacher Studio"
          title="Co-productions are on the roadmap."
          description="Split revenue with a co-creator and track each partner's share automatically — it's on the Skillset roadmap. Today, every payout routes to the course owner's connected account."
          notifyFeature="Co-productions"
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

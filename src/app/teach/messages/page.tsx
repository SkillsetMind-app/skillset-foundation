import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";

export default function TeacherMessagesPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Student messages"
        title="Answer your students."
        description="Private per-course threads from enrolled students. Replies land in the student's classroom and notification bell."
      >
        <TeacherMessagesInbox />
      </PlatformShell>
    </ProtectedSurface>
  );
}

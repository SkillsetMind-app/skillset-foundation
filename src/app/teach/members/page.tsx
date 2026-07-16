import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherMembersAreaHub } from "@/components/teacher/teacher-members-area-hub";

export default function TeacherMembersPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell title="Members areas" hideHeader>
        <TeacherMembersAreaHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

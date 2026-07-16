import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorMarketingHub } from "@/components/teacher/creator-marketing-hub";

export default function TeacherMarketingPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Marketing" hideHeader>
        <CreatorMarketingHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

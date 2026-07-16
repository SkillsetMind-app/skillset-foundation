import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorAffiliateHub } from "@/components/teacher/creator-affiliate-hub";

export default function TeacherAffiliatesPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Affiliate programs" hideHeader>
        <CreatorAffiliateHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

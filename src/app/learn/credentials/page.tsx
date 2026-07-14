import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnCredentialsHub } from "@/components/learn/learn-credentials-hub";
import { PlatformShell } from "@/components/platform/platform-shell";

export default function LearnCredentialsPage() {
  return (
    <ProtectedSurface permissions={["certificates.view"]}>
      <PlatformShell
        eyebrow="Credentials"
        title="Track your SkillsetMind Verified progress."
        description="Credentials begin with course completion eligibility. Issuance remains controlled by SkillsetMind so certificates can stay trustworthy."
      >
        <LearnCredentialsHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

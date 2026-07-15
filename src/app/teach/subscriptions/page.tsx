import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorSubscriptionCenter } from "@/components/teacher/creator-subscription-center";

export default function TeacherSubscriptionsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow="Teacher Studio"
        title="Subscriptions."
        description="Recurring revenue, subscriber health, cancellation signals, and every renewal in one operational view."
      >
        <CreatorSubscriptionCenter />
      </PlatformShell>
    </ProtectedSurface>
  );
}

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherComingSoonPanel } from "@/components/teacher/teacher-coming-soon-panel";

export default function TeacherCouponsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Coupons & promotions" hideHeader>
        <TeacherComingSoonPanel
          eyebrow="Teacher Studio"
          title="Coupons & promotions are on the roadmap."
          description="Discount codes, time-boxed launch pricing, and bundle offers are coming to Skillset. For now, set your course price directly in the builder."
          primaryHref="/teach/builder"
          primaryLabel="Open Course Builder"
          notifyFeature="Coupons & promotions"
        />
      </PlatformShell>
    </ProtectedSurface>
  );
}

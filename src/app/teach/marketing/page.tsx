import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorMarketingHub } from "@/components/teacher/creator-marketing-hub";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function TeacherMarketingPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("teach.marketing.eyebrow")} hideHeader>
        <CreatorMarketingHub />
      </PlatformShell>
    </ProtectedSurface>
  );
}

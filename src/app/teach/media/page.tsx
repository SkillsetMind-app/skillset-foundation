import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherMediaLibrary } from "@/components/teacher/teacher-media-library";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teacherMedia.eyebrow");
}

export default async function TeacherMediaPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("teacherMedia.eyebrow")} hideHeader>
        <TeacherMediaLibrary />
      </PlatformShell>
    </ProtectedSurface>
  );
}

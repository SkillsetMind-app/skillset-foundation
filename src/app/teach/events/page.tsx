import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function TeacherEventsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      <PlatformShell
        title={t("teach.eventsPage.title")}
        compact
      >
        <TeacherEventStudio />
      </PlatformShell>
    </ProtectedSurface>
  );
}

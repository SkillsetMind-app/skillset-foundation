import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.messagesPage.title");
}

export default async function TeacherMessagesPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("creatorPanel.hub.sales.messages")}
        title={t("teach.messagesPage.title")}
        description={t("teach.messagesPage.description")}
      >
        <TeacherMessagesInbox />
      </PlatformShell>
    </ProtectedSurface>
  );
}

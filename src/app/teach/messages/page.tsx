import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherInboxQuestions } from "@/components/teacher/teacher-inbox-questions";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.inbox");
}

// The teacher's Inbox: the questions waiting for them in the
// communities and the private conversations with learners, on one screen. The address
// stays /teach/messages: the bell notices and the old links already point
// here.
export default async function TeacherInboxPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        title={t("platform.nav.inbox")}
        description={t("teach.inboxPage.description")}
        compact
      >
        <TeacherInboxQuestions />
        <section aria-labelledby="inbox-messages-title" className="grid gap-3">
          <h2 id="inbox-messages-title" className="text-lg font-semibold text-[var(--color-ink)]">
            {t("teach.inboxPage.messagesTitle")}
          </h2>
          <TeacherMessagesInbox />
        </section>
      </PlatformShell>
    </ProtectedSurface>
  );
}

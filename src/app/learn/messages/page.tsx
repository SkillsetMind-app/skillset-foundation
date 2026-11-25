import { getServerTranslation } from "@/lib/i18n/server";
import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { PlatformShell } from "@/components/platform/platform-shell";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learnWave2.messagesPage.title");
}

// The learner's inbox: one conversation per course, modeled on the one the
// teacher already has in /teach/messages. Before, the learner could only reply
// to the teacher at the bottom of each lesson page — three courses, three
// places, no list.
export default async function LearnMessagesPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow={t("learnWave2.messagesPage.eyebrow")}
        title={t("learnWave2.messagesPage.title")}
        description={t("learnWave2.messagesPage.description")}
      >
        {/* useSearchParams (the open conversation lives in ?course=) requires
            Suspense on the route. The wait is the same as the inbox's (list of
            conversations as a skeleton, in the same tone, so nothing changes
            color on the handoff), not a blank area. */}
        <Suspense
          fallback={
            <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
              <p className="sr-only" role="status">
                {t("learnWave2.messages.loading")}
              </p>
              <div aria-hidden="true" className="grid content-start gap-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-[84px] animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
                ))}
              </div>
            </div>
          }
        >
          <StudentMessagesInbox />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

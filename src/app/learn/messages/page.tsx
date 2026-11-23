import { getServerTranslation } from "@/lib/i18n/server";
import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { PlatformShell } from "@/components/platform/platform-shell";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learnWave2.messagesPage.title");
}

// A caixa de entrada do aluno: uma conversa por curso, no molde da que o
// professor ja tem em /teach/messages. Antes o aluno so respondia ao professor
// no fim da pagina de cada aula — tres cursos, tres lugares, nenhuma lista.
export default async function LearnMessagesPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow={t("learnWave2.messagesPage.eyebrow")}
        title={t("learnWave2.messagesPage.title")}
        description={t("learnWave2.messagesPage.description")}
      >
        {/* useSearchParams (a conversa aberta vive em ?course=) exige Suspense
            na rota. A espera é a mesma da caixa (lista de conversas em
            esqueleto, no mesmo tom, para nada trocar de cor na passagem), não
            uma área em branco. */}
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

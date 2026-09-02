import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { PlatformShell } from "@/components/platform/platform-shell";

// A caixa de entrada do aluno: uma conversa por curso, no molde da que o
// professor ja tem em /teach/messages. Antes o aluno so respondia ao professor
// no fim da pagina de cada aula — tres cursos, tres lugares, nenhuma lista.
export default function LearnMessagesPage() {
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow="Messages"
        title="Your conversations with teachers."
        description="One private thread per course. Replies also land in your notification bell."
      >
        {/* useSearchParams (a conversa aberta vive em ?course=) exige Suspense
            na rota. */}
        <Suspense fallback={null}>
          <StudentMessagesInbox />
        </Suspense>
      </PlatformShell>
    </ProtectedSurface>
  );
}

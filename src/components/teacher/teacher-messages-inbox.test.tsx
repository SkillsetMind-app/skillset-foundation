import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import type { CourseMessage } from "@/domain/course-message";

// Mesmo molde do student-messages-inbox.test.tsx: um objeto de usuario para a
// sessao inteira e a assinatura devolvendo as mensagens na hora.
const mocks = vi.hoisted(() => ({
  messages: [] as unknown[],
  auth: {
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", roles: ["teacher"] },
  },
}));

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToTeacherMessages: vi.fn(
    (_teacherId: string, onNext: (messages: unknown[]) => void) => {
      onNext(mocks.messages);
      return vi.fn();
    },
  ),
  sendCourseMessage: vi.fn(() => Promise.resolve({ success: true, messageId: "m-new" })),
}));

const fromStudent: CourseMessage = {
  id: "m1",
  courseId: "course-1",
  courseTitle: "Leadership",
  studentId: "student-1",
  studentName: "Ana",
  teacherId: "teacher-1",
  senderId: "student-1",
  body: "Hello!",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

describe("caixa de mensagens do professor", () => {
  // A lista e a conversa chamavam o formatador de hora sem `t` nem `locale`:
  // em espanhol a hora saia em ingles ("5m ago").
  it("mostra a hora da conversa no idioma da pessoa", () => {
    mocks.messages = [fromStudent];
    render(
      <I18nProvider initialLocale="es">
        <TeacherMessagesInbox />
      </I18nProvider>,
    );

    // Uma vez na lista de alunos, outra na mensagem aberta (a primeira
    // conversa ja vem aberta).
    expect(screen.getAllByText(/Hace 5 min/)).toHaveLength(2);
  });
});

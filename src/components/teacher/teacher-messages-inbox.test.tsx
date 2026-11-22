import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import type { CourseMessage } from "@/domain/course-message";

// Mesmo molde do student-messages-inbox.test.tsx: um objeto de usuario para a
// sessao inteira e a assinatura devolvendo as mensagens na hora.
const mocks = vi.hoisted(() => ({
  messages: [] as unknown[],
  // "data": a leitura chega na hora; "pending": ainda nao chegou; "error": falhou.
  mode: "data" as "data" | "pending" | "error",
  emit: (() => undefined) as (messages: unknown[]) => void,
  fail: (() => undefined) as () => void,
  unsubscribe: vi.fn(),
  reloads: 0,
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
    (_teacherId: string, onNext: (messages: unknown[]) => void, onError: (error: Error) => void) => {
      const read = () => {
        if (mocks.mode === "data") onNext(mocks.messages);
        if (mocks.mode === "error") onError(new Error("offline"));
      };
      mocks.emit = onNext;
      mocks.fail = () => onError(new Error("offline"));
      read();
      // Como o de verdade: desligar o canal, e `reload` que le de novo sem mexer nele.
      return Object.assign(mocks.unsubscribe, {
        reload: vi.fn(async () => {
          mocks.reloads += 1;
          read();
        }),
      });
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

function show() {
  return render(
    <I18nProvider initialLocale="en">
      <TeacherMessagesInbox />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.messages = [];
  mocks.mode = "data";
  mocks.reloads = 0;
  mocks.unsubscribe.mockClear();
});
afterEach(cleanup);

describe("caixa do professor antes, durante e depois da leitura", () => {
  it("antes da primeira leitura mostra carregando, nao 'No student messages yet'", () => {
    mocks.mode = "pending";
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your student messages...");
    expect(screen.queryByText("No student messages yet")).toBeNull();

    act(() => mocks.emit([]));
    expect(screen.getByText("No student messages yet")).toBeTruthy();
  });

  it("se a primeira leitura falha: erro com 'Try again', que le de novo pelo mesmo canal", async () => {
    mocks.mode = "error";
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your student messages.");
    expect(screen.queryByText("No student messages yet")).toBeNull();

    mocks.mode = "data";
    mocks.messages = [fromStudent];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(mocks.reloads).toBe(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Student threads" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("releitura que falha com a lista na tela: a lista fica e o aviso aparece", () => {
    mocks.messages = [fromStudent];
    show();
    act(() => mocks.fail());
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your student messages.");
    expect(screen.getByRole("navigation", { name: "Student threads" })).toBeTruthy();
  });
});

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

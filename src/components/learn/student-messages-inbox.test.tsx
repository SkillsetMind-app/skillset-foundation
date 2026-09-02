import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { platformNav } from "@/data/site";
import type { CourseMessage } from "@/domain/course-message";
import { sendCourseMessage } from "@/lib/data/course-messages";

/**
 * Reanalise item 12 — a caixa de mensagens do aluno. Antes, responder ao
 * professor exigia rolar ate o fim da pagina de cada aula; com tres cursos,
 * tres lugares, e nenhuma lista. Aqui: uma conversa por curso, a aberta no
 * endereco (?course=), e a volta sempre no canto superior esquerdo.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  messages: [] as unknown[],
  subscriptions: 0,
  // Um objeto de usuario para a sessao inteira (objeto novo por render
  // reinscreve o efeito e entra em laco).
  auth: { status: "authenticated", user: { uid: "student-1", email: "s@example.com", roles: ["student"] } },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/messages",
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToStudentMessages: vi.fn(
    (_studentId: string, onNext: (messages: unknown[]) => void) => {
      mocks.subscriptions += 1;
      if (mocks.subscriptions > 20) {
        throw new Error("subscribeToStudentMessages chamado mais de 20 vezes: laco de render");
      }
      onNext(mocks.messages);
      return vi.fn();
    },
  ),
  sendCourseMessage: vi.fn(() => Promise.resolve({ success: true, messageId: "m-new" })),
}));

function message(overrides: Partial<CourseMessage>): CourseMessage {
  return {
    id: "m",
    courseId: "course-1",
    courseTitle: "Leadership",
    studentId: "student-1",
    studentName: "Student",
    teacherId: "teacher-1",
    senderId: "teacher-1",
    body: "hello",
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

const twoCourses = [
  message({ id: "m1", body: "Welcome to Leadership", createdAt: "2026-09-01T10:00:00.000Z" }),
  message({ id: "m2", senderId: "student-1", body: "Thanks!", createdAt: "2026-09-01T11:00:00.000Z" }),
  message({
    id: "m3",
    courseId: "course-2",
    courseTitle: "Communication",
    body: "Any questions about module 2?",
    createdAt: "2026-09-02T09:00:00.000Z",
  }),
];

function renderInbox(search = "", messages: unknown[] = twoCourses) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.messages = messages;
  return render(<StudentMessagesInbox />);
}

describe("caixa de mensagens do aluno", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.subscriptions = 0;
    vi.mocked(sendCourseMessage).mockClear();
  });

  it("uma conversa por curso, a mais recente primeiro, dizendo quem falou por ultimo", () => {
    renderInbox();

    const list = screen.getByRole("navigation", { name: "Conversations" });
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Communication");
    expect(items[0]).toHaveTextContent("Teacher: Any questions about module 2?");
    expect(items[1]).toHaveTextContent("Leadership");
    expect(items[1]).toHaveTextContent("You: Thanks!");
  });

  it("abrir uma conversa grava o curso no endereco", () => {
    renderInbox();

    fireEvent.click(screen.getByRole("button", { name: /Communication/ }));

    expect(mocks.push).toHaveBeenCalledWith("/learn/messages?course=course-2");
  });

  it("?course= abre aquela conversa, com a volta levando a lista", () => {
    renderInbox("course=course-1");

    const thread = screen.getByRole("region", { name: "Conversation: Leadership" });
    expect(within(thread).getByText("Welcome to Leadership")).toBeInTheDocument();
    expect(within(thread).getByText("Thanks!")).toBeInTheDocument();
    expect(within(thread).queryByText(/module 2/)).toBeNull();

    expect(screen.getByRole("link", { name: /All conversations/ })).toHaveAttribute(
      "href",
      "/learn/messages",
    );
  });

  it("na lista, a volta leva ao painel", () => {
    renderInbox();

    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute("href", "/learn");
  });

  it("responder manda pelo mesmo caminho da aula: o proprio aluno, naquele curso", async () => {
    renderInbox("course=course-2");

    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "Yes — about the exercise." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendCourseMessage).toHaveBeenCalledWith({
        courseId: "course-2",
        studentId: "student-1",
        body: "Yes — about the exercise.",
      }),
    );
  });

  it("sem conversa: um estado vazio de uma linha, com a volta", () => {
    renderInbox("", []);

    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute("href", "/learn");
  });
});

describe("grupo Account na barra lateral do aluno", () => {
  it("Messages existe no grupo Account, so para o aluno", () => {
    const item = platformNav.find((entry) => entry.href === "/learn/messages");

    expect(item).toMatchObject({ sectionKey: "account", contexts: ["learner"] });
  });

  it("avisos, compras e configuracoes aparecem para o aluno (antes: so no menu do avatar)", () => {
    for (const href of ["/account", "/account/billing", "/account/notifications"]) {
      const item = platformNav.find((entry) => entry.href === href);
      expect(item?.contexts, href).toContain("learner");
      expect(item?.sectionKey, href).toBe("account");
    }
  });
});

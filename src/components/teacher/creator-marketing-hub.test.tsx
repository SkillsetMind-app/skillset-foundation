import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorMarketingHub } from "@/components/teacher/creator-marketing-hub";
import type { CourseMessage } from "@/domain/course-message";
import type { TeacherCourse } from "@/domain/teacher-course";

// O que a pessoa sofria: Marketing era uma lista de cinco linhas sem nenhum
// estado — nao dava para saber se a vitrine estava no ar, quantas mensagens
// esperavam resposta nem quantos arquivos havia na midia sem abrir cada tela.
// Estas provas cobrem os estados reais dos cartoes e o caso em que o dado nao
// existe: o cartao aparece sem numero, nunca com numero inventado.

const mocks = vi.hoisted(() => {
  const course = (id: string, status: TeacherCourse["status"]): TeacherCourse => ({
    id,
    ownerId: "teacher-1",
    title: `Curso ${id}`,
    summary: "",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status,
    modules: [],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  });

  const message = (id: string, senderId: string): CourseMessage => ({
    id,
    courseId: `course-${id}`,
    courseTitle: "Curso",
    studentId: `student-${id}`,
    studentName: "Aluna",
    teacherId: "teacher-1",
    senderId,
    body: "Ola",
    createdAt: "2026-09-01T10:00:00.000Z",
  });

  return {
    course,
    message,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve os
    // efeitos e entra em laco.
    user: { uid: "teacher-1", displayName: "Ana", roles: ["teacher"] },
    subscribeToTeacherCourses: vi.fn(),
    subscribeToTeacherMessages: vi.fn(),
    countCourseAssets: vi.fn(),
  };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: mocks.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToTeacherMessages: mocks.subscribeToTeacherMessages,
}));

vi.mock("@/lib/data/course-assets", () => ({
  countCourseAssets: mocks.countCourseAssets,
}));

function cardNamed(title: string) {
  return screen.getByRole("heading", { name: title, level: 3 }).closest("article")!;
}

describe("CreatorMarketingHub", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.subscribeToTeacherCourses.mockReset();
    mocks.subscribeToTeacherMessages.mockReset();
    mocks.countCourseAssets.mockReset();
  });

  function givenCourses(courses: TeacherCourse[]) {
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, onData: (list: TeacherCourse[]) => void) => {
        onData(courses);
        return vi.fn();
      },
    );
  }

  function givenMessages(messages: CourseMessage[]) {
    mocks.subscribeToTeacherMessages.mockImplementation(
      (_uid: string, onData: (list: CourseMessage[]) => void) => {
        onData(messages);
        return vi.fn();
      },
    );
  }

  it("mostra os cinco cartoes com o estado real de cada um", async () => {
    givenCourses([mocks.course("c1", "published"), mocks.course("c2", "draft")]);
    // Duas conversas: a do aluno espera resposta, a que o professor respondeu nao.
    givenMessages([
      mocks.message("a", "student-a"),
      mocks.message("b", "teacher-1"),
    ]);
    mocks.countCourseAssets.mockResolvedValue(12);

    render(<CreatorMarketingHub />);

    expect(await screen.findByText("12 files")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);

    const storefront = cardNamed("Storefront & product pages");
    expect(within(storefront).getByText("Published")).toBeInTheDocument();
    expect(
      within(storefront).getByRole("link", { name: /Open public page/ }),
    ).toHaveAttribute("href", "/instructors/teacher-1");

    expect(
      within(cardNamed("Buyer messages")).getByText("1 awaiting reply"),
    ).toBeInTheDocument();
    expect(
      within(cardNamed("Coupons & promotions")).getByText("Set per product"),
    ).toBeInTheDocument();
    expect(within(cardNamed("Integrations")).getByText("Planned")).toBeInTheDocument();
  });

  it("no zero, diz que a vitrine nao esta publicada e que nada espera resposta", async () => {
    givenCourses([mocks.course("c1", "draft")]);
    givenMessages([]);
    mocks.countCourseAssets.mockResolvedValue(0);

    render(<CreatorMarketingHub />);

    expect(await screen.findByText("0 files")).toBeInTheDocument();
    expect(
      within(cardNamed("Storefront & product pages")).getByText("Not published yet"),
    ).toBeInTheDocument();
    expect(
      within(cardNamed("Buyer messages")).getByText("No reply pending"),
    ).toBeInTheDocument();
  });

  it("sem o dado, o cartao aparece sem numero em vez de inventar um", async () => {
    givenCourses([mocks.course("c1", "published")]);
    // A inscricao falha: o callback de erro zera as mensagens carregadas.
    mocks.subscribeToTeacherMessages.mockImplementation(
      (_uid: string, _onData: unknown, onError: () => void) => {
        onError();
        return vi.fn();
      },
    );
    mocks.countCourseAssets.mockRejectedValue(new Error("sem permissao"));

    render(<CreatorMarketingHub />);

    // O cartao da vitrine responde, entao a tela ja renderizou o estado.
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.queryByText(/file(s)?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting reply/)).not.toBeInTheDocument();
    expect(screen.queryByText("No reply pending")).not.toBeInTheDocument();
    // O cartao continua na grade, so sem numero.
    expect(cardNamed("Media library")).toBeInTheDocument();
    expect(cardNamed("Buyer messages")).toBeInTheDocument();
  });
});

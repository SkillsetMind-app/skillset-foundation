import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import type { TeacherCourse } from "@/domain/teacher-course";

// "O que aconteceu enquanto eu nao olhava?" nao tinha resposta na Home: havia
// proximos passos, produtos e metricas, e nenhuma linha do tempo. Aqui as
// quatro fontes que ja existem (vendas, matriculas, avaliacoes e perguntas)
// entram numa lista so, a mais recente primeiro.

const mocks = vi.hoisted(() => ({
  orders: [] as unknown[],
  students: [] as unknown[],
  reviews: [] as unknown[],
  questions: [] as unknown[],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1" } }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "teach.activity.title": "Recent activity",
        "teach.activity.sale": "New sale in {course}",
        "teach.activity.enrollment": "{name} enrolled in {course}",
        "teach.activity.review": "New {rating}-star review in {course}",
        "teach.activity.question": "{name} asked a question in {course}",
        "teach.activity.emptyTitle": "Nothing has happened yet.",
      })[key] ?? key,
  }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData(mocks.orders);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve(mocks.students),
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve(mocks.reviews),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve(mocks.questions),
}));

const courses = [
  { id: "course-1", title: "Hypnosis Basics", status: "published" },
] as TeacherCourse[];

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  mocks.orders = [];
  mocks.students = [];
  mocks.reviews = [];
  mocks.questions = [];
});

afterEach(cleanup);

describe("Recent activity na Home do professor", () => {
  it("professor novo ve um estado vazio honesto, nao uma grade de zeros", async () => {
    render(<StudioRecentActivity courses={[]} />);

    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("junta venda, matricula, avaliacao e pergunta na mesma lista, a mais recente primeiro", async () => {
    mocks.orders = [
      {
        id: "order-1",
        status: "paid",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(3),
      },
      // Pedido nao pago nao e um evento: ninguem comprou nada.
      {
        id: "order-2",
        status: "pending",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(1),
      },
    ];
    mocks.students = [
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        displayName: "Ana",
        enrolledAt: isoDaysAgo(1),
      },
    ];
    mocks.reviews = [
      { id: "rev-1", courseId: "course-1", rating: 5, createdAt: isoDaysAgo(4) },
    ];
    mocks.questions = [
      {
        id: "post-1",
        courseSlug: "course-1",
        authorName: "Bruno",
        createdAt: isoDaysAgo(2),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const items = await screen.findAllByRole("listitem");
    const lines = items.map((item) => item.textContent);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Ana enrolled in Hypnosis Basics");
    expect(lines[1]).toContain("Bruno asked a question in Hypnosis Basics");
    expect(lines[2]).toContain("New sale in Hypnosis Basics");
    expect(lines[3]).toContain("New 5-star review in Hypnosis Basics");
    expect(screen.queryByText("Nothing has happened yet.")).toBeNull();
  });

  it("cada linha leva para a tela que responde por aquele evento", async () => {
    mocks.orders = [
      {
        id: "order-1",
        status: "paid",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(1),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    expect(await screen.findByRole("link", { name: /New sale/ })).toHaveAttribute(
      "href",
      "/teach/sales/order-1",
    );
  });

  // O painel de UM produto passa a mesma lista com um curso so. Sem o recorte,
  // a venda e a matricula de outro produto entravam na atividade dele: as duas
  // leituras trazem a loja inteira, so as avaliacoes e as perguntas ja vinham
  // filtradas por curso.
  it("mostra so o que aconteceu nos cursos que recebeu, nunca na loja inteira", async () => {
    mocks.orders = [
      {
        id: "order-2",
        status: "paid",
        courseId: "course-2",
        courseTitle: "Outro Produto",
        paidAt: isoDaysAgo(1),
      },
    ];
    mocks.students = [
      {
        enrollmentId: "enr-2",
        courseId: "course-2",
        courseTitle: "Outro Produto",
        displayName: "Ana",
        enrolledAt: isoDaysAgo(1),
      },
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        displayName: "Bruno",
        enrolledAt: isoDaysAgo(2),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Bruno enrolled in Hypnosis Basics");
  });
});

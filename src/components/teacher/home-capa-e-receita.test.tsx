import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

const { mockUser, state } = vi.hoisted(() => ({
  mockUser: {
    uid: "teacher-1",
    displayName: "Patrick Simon",
    roles: ["teacher"],
  },
  state: {
    courses: [] as unknown[],
    orders: [] as unknown[],
  },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (_uid: string, onData: (courses: unknown[]) => void) => {
    onData(state.courses);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData(state.orders);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none" });
    return () => undefined;
  },
}));

function course(id: string, title: string, coverImageUrl: string | null) {
  return {
    id,
    title,
    status: "published",
    modules: [],
    lessonCount: 1,
    coverImageUrl,
  };
}

beforeEach(() => {
  state.courses = [];
  state.orders = [];
});

afterEach(cleanup);

// A pessoa nao reconhecia o proprio produto: o card da home era so texto.
describe("Home do professor: o card do produto mostra a capa", () => {
  it("usa a capa do produto quando ela existe e o placeholder quando nao existe", async () => {
    state.courses = [
      course("com-capa", "Curso com capa", "https://cdn.example/cover.jpg"),
      course("sem-capa", "Curso sem capa", null),
    ];

    render(<TeacherStudioDashboard />);

    const comCapa = await screen.findByRole("link", { name: /Curso com capa/ });
    const semCapa = screen.getByRole("link", { name: /Curso sem capa/ });

    const img = comCapa.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.example/cover.jpg");
    // Capa decorativa: o titulo do produto ja esta no card como texto.
    expect(img).toHaveAttribute("alt", "");

    // Sem capa nao inventamos imagem: fica o mesmo icone da lista de produtos.
    expect(semCapa.querySelector("img")).toBeNull();
    expect(semCapa.querySelector("svg")).not.toBeNull();
  });
});

// Antes da 1a venda o bloco de desempenho era ~700px de nada.
describe("Home do professor: desempenho so com historico de venda", () => {
  it("sem nenhuma venda esconde o grafico e o Top courses, mas mantem os tiles", async () => {
    state.courses = [course("c1", "Curso sem venda", null)];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    // Os tiles ficam, com as dicas de vazio que ja tem.
    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
    expect(screen.getByText("New students")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Revenue" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Top courses" })).toBeNull();
    expect(screen.queryByText("No revenue yet")).toBeNull();
  });

  it("com uma venda paga o grafico e o Top courses voltam", async () => {
    state.courses = [course("c1", "Curso vendido", null)];
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Curso vendido",
        status: "paid",
        amountMinor: 9900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Revenue" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Top courses" })).toBeInTheDocument();
  });
});

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

const { mockUser, state } = vi.hoisted(() => ({
  mockUser: {
    uid: "teacher-1",
    displayName: "Preston Sloan",
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
  claimWelcomeTour: vi.fn(async () => false),
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

// The person did not recognize their own product: the home card was text only.
describe("Teacher home: the product card shows the cover", () => {
  it("uses the product cover when it exists and the placeholder when it does not", async () => {
    state.courses = [
      course("com-capa", "Curso com capa", "https://cdn.example/cover.jpg"),
      course("sem-capa", "Curso sem capa", null),
    ];

    render(<TeacherStudioDashboard />);

    // Scoped to the products section: the course title also appears in
    // other home blocks (Top courses, activity), and a loose search would be
    // ambiguous depending on whether those blocks appear or not.
    const produtos = await screen.findByRole("region", {
      name: "Products in your workspace",
    });
    const comCapa = within(produtos).getByRole("link", { name: /Curso com capa/ });
    const semCapa = within(produtos).getByRole("link", { name: /Curso sem capa/ });

    const img = comCapa.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.example/cover.jpg");
    // Decorative cover: the product title is already on the card as text.
    expect(img).toHaveAttribute("alt", "");

    // With no cover we do not invent an image: the same icon as the products list stays.
    expect(semCapa.querySelector("img")).toBeNull();
    expect(semCapa.querySelector("svg")).not.toBeNull();
  });
});

// Before the 1st sale the performance block was ~700px of nothing.
describe("Teacher home: performance only with sales history", () => {
  it("with no sales, hides the chart, Top courses and the $0 tiles", async () => {
    state.courses = [course("c1", "Curso sem venda", null)];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    // The $0 / 0 tiles also go away: they only appear with the 1st paid sale.
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
    expect(screen.queryByText("New students")).toBeNull();

    expect(screen.queryByRole("heading", { name: "Revenue" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Top courses" })).toBeNull();
    expect(screen.queryByText("No revenue yet")).toBeNull();
  });

  it("with one paid sale, the chart and Top courses come back", async () => {
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

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    uid: "teacher-1",
    displayName: "Patrick Simon",
    roles: ["teacher"],
  },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    locale: "en-US",
    t: (key: string) =>
      ({
        "teach.dashboard.welcomeBackNamed": "Welcome back, {name}",
        "teach.dashboard.welcomeBack": "Welcome back",
        "platform.banner.connectPayouts":
          "Connect your Stripe account before selling paid courses - buyers are charged on it directly.",
        "teach.activity.title": "Recent activity",
        "teach.activity.emptyTitle": "Nothing has happened yet.",
        "teach.activity.emptyDescription": "Enrollments, sales and questions land here.",
        "teach.storefrontCard.title": "Your storefront",
        "teach.storefrontCard.empty": "The page exists, but nothing is published on it yet.",
        "teach.storefrontCard.open": "Open storefront",
        "teach.storefrontCard.edit": "Edit storefront",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/teacher/teacher-overview-metrics", () => ({
  TeacherOverviewMetrics: () => <div>Overview metrics</div>,
}));

vi.mock("@/components/teacher/teacher-studio-insights", () => ({
  TeacherStudioInsights: () => <div>Studio insights</div>,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (_uid: string, onData: (courses: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData([]);
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

afterEach(cleanup);

describe("TeacherStudioDashboard", () => {
  it("matches the producer Home hierarchy with three next steps", async () => {
    render(<TeacherStudioDashboard />);

    const progress = await screen.findByRole("list", {
      name: "Creator next steps",
    });
    const items = within(progress).getAllByRole("listitem");

    expect(items).toHaveLength(3);
    expect(within(progress).getByText("Create a product")).toBeInTheDocument();
    expect(within(progress).getByText("Complete creator data")).toBeInTheDocument();
    expect(within(progress).getByText("Prepare product to sell")).toBeInTheDocument();
  });

  it("routes each viable format to the correct workflow", async () => {
    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Online course/i })).toHaveAttribute(
        "href",
        "/teach/builder?newCourse=1&format=course"
      );
    });
    expect(screen.getByRole("link", { name: /Subscription/i })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=subscription"
    );
    expect(screen.getByRole("link", { name: /Community/i })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=community"
    );
    expect(screen.getByRole("link", { name: /Online event/i })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=event"
    );
    expect(screen.getByRole("link", { name: /Guided program/i })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=program"
    );
  });
});

// --- Onda 6: casca do professor -------------------------------------------

describe("Home do professor: uma manchete, o que aconteceu e a vitrine", () => {
  it("tem UMA manchete de nivel 1 (o olho 'Producer home' saiu)", async () => {
    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome back, Patrick",
    );
    expect(screen.queryByText("Producer home")).toBeNull();
  });

  it("o aviso do Stripe virou um passo da lista, sem faixa fixa", async () => {
    render(<TeacherStudioDashboard />);

    const steps = await screen.findByRole("list", { name: "Creator next steps" });
    const step = within(steps).getByText("Complete creator data");

    expect(step).toBeInTheDocument();
    // A frase que MOROU na faixa amarela permanente do topo do /teach.
    expect(
      within(steps).getByText(/buyers are charged on it directly/i),
    ).toBeInTheDocument();
  });

  it("mostra 'Recent activity' com estado vazio honesto para professor novo", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("mostra 'Your storefront' com o endereco publico e os dois caminhos", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Your storefront" }),
    ).toBeInTheDocument();
    expect(screen.getByText("/instructors/teacher-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open storefront/ })).toHaveAttribute(
      "href",
      "/instructors/teacher-1",
    );
    expect(screen.getByRole("link", { name: "Edit storefront" })).toHaveAttribute(
      "href",
      "/teach/storefront",
    );
    // Nada publicado ainda: nao dizemos que a vitrine esta no ar.
    expect(
      screen.getByText("The page exists, but nothing is published on it yet."),
    ).toBeInTheDocument();
  });
});

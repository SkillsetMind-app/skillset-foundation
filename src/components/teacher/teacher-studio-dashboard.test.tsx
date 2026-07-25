import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

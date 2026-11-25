import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { StudioSeed } from "@/lib/data/server/studio-home";

// The studio home used to render without products or publish gates and read
// five things in the browser. "Next steps" arrived last and pushed "My
// products" down the page (a 0.45 layout shift on a first visit). The server
// now sends the products and the gates with the page. Proved here: the first
// HTML already has both blocks, hydrating it is clean, and the data is never
// drawn where it is not the truth: for another account, or again when the page
// comes back from the cache.

const state = vi.hoisted(() => ({
  user: { uid: "teacher-1", displayName: "Patrick Simon", roles: ["teacher"] },
  subscribed: [] as string[],
  // The browser's own reads: the tests decide when, and what, they answer.
  deliverCourses: (() => undefined) as (courses: unknown[]) => void,
  failCourses: (() => undefined) as () => void,
  failProfile: (() => undefined) as () => void,
  never: () => new Promise<never>(() => {}),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: state.user }),
}));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    uid: string,
    onData: (courses: TeacherCourse[]) => void,
    onError: (error: Error) => void,
  ) => {
    state.subscribed.push(uid);
    state.deliverCourses = (courses) => onData(courses as TeacherCourse[]);
    state.failCourses = () => onError(new Error("offline"));
    return Object.assign(() => undefined, { reload: async () => undefined });
  },
}));
// Sales never answer here: nothing about them is seeded, and they stay loading.
vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: () => Object.assign(() => undefined, { reload: async () => undefined }),
}));
vi.mock("@/lib/data/enrollments", () => ({ getMyCourseStudents: () => Promise.resolve([]) }));
vi.mock("@/lib/data/course-reviews", () => ({ getRecentCourseReviews: () => Promise.resolve([]) }));
vi.mock("@/lib/data/community-posts", () => ({ getRecentCommunityQuestions: () => Promise.resolve([]) }));
vi.mock("@/lib/data/payout-ledger", () => ({ subscribeToTeacherPayoutLedger: () => () => undefined }));
vi.mock("@/lib/data/user-profiles", () => ({
  claimWelcomeTour: vi.fn(async () => false),
  subscribeToUserProfile: (_uid: string, _onData: unknown, onError: () => void) => {
    state.failProfile = onError;
    return () => undefined;
  },
}));
// The gates the browser reads never answer either: what shows came from the seed.
vi.mock("@/lib/data/creator-verification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/data/creator-verification")>(),
  fetchRequireCreatorVerification: state.never,
  fetchCreatorActivationBlocked: state.never,
}));
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: state.never }));

function courseRow(id: string, title: string) {
  return {
    id,
    owner_id: "teacher-1",
    title,
    title_key: null,
    summary: "",
    category: "Soft Skills",
    categories: null,
    learning_outcomes: null,
    product_format: "course",
    status: "draft",
    modules: [],
    lesson_count: 0,
    price_amount_minor: 0,
    currency: "USD",
    payment_type: null,
    installments_enabled: null,
    installments_max: null,
    platform_fee_bps: null,
    drip_strategy: null,
    drip_interval_days: null,
    free_preview_lesson_id: null,
    cover_image_url: null,
    members_theme: null,
    members_cover_asset_id: null,
    members_title: null,
    members_subtitle: null,
    members_description: null,
    community_enabled: false,
    review_note: null,
    rating_average: null,
    rating_count: null,
    review_count: null,
    featured: null,
    featured_rank: null,
    enrollment_count: null,
    trending_score: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-02T10:00:00.000Z",
  };
}

const gates = {
  payoutsReady: false,
  verificationStatus: "none",
  stripeConnectCountry: null,
  planId: "free",
  requireVerification: false,
  activationBlocked: false,
  planRequired: true,
};

// A new read every time, as each page load is.
let reads = 0;
function seed(overrides: Partial<{ uid: string; gates: Record<string, unknown> }> = {}) {
  reads += 1;
  return {
    id: `read-${reads}`,
    uid: "teacher-1",
    courseRows: [courseRow("c1", "Negotiation Basics")],
    gates,
    ...overrides,
  } as unknown as StudioSeed;
}

beforeEach(() => {
  state.user = { uid: "teacher-1", displayName: "Patrick Simon", roles: ["teacher"] };
  state.subscribed = [];
  window.localStorage.clear();
});

afterEach(cleanup);

describe("TeacherStudioDashboard with products and gates sent by the server", () => {
  it("the server HTML already has the product and the next steps, with the greeting of someone who has a product", () => {
    const html = renderToString(<TeacherStudioDashboard seed={seed()} />);

    expect(html).toContain("Welcome back, Patrick");
    expect(html).toContain("Negotiation Basics");
    // "Next steps" is on the page from the start: nothing to push the list down later.
    expect(html).toContain("Get ready for your first sale");
    // The gate the server answered decides the steps: a plan is required here.
    expect(html).toContain("Creator plan");
  });

  it("with nothing from the server it is the home before its data, as it was", () => {
    const html = renderToString(<TeacherStudioDashboard seed={null} />);

    expect(html).toContain("Hello, Patrick");
    expect(html).not.toContain("Negotiation Basics");
    expect(html).not.toContain("Get ready for your first sale");
  });

  it("a gate the server could not read keeps 'next steps' back until the browser reads it", () => {
    const html = renderToString(
      <TeacherStudioDashboard seed={seed({ gates: { ...gates, planRequired: null } })} />,
    );

    expect(html).toContain("Negotiation Basics");
    expect(html).not.toContain("Get ready for your first sale");
  });

  it("never draws products that were read for another account", () => {
    state.user = { uid: "teacher-2", displayName: "Someone Else", roles: ["teacher"] };
    const html = renderToString(<TeacherStudioDashboard seed={seed()} />);

    expect(html).not.toContain("Negotiation Basics");
    expect(html).toContain("Hello, Someone");
  });

  it("hydrates the server HTML cleanly and still opens the live read", async () => {
    const value = seed();
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<TeacherStudioDashboard seed={value} />);

    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <TeacherStudioDashboard seed={value} />, {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });

    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Negotiation Basics");
    expect(state.subscribed).toEqual(["teacher-1"]);

    await act(async () => root.unmount());
    errors.mockRestore();
    container.remove();
  });

  // The Back button restores the page from the router's cache with the SAME
  // seed, by then out of date. That mount reads fresh, as it always did.
  it("draws a given read once: the same page restored later starts without it", async () => {
    const value = seed();
    let first!: ReturnType<typeof render>;
    await act(async () => {
      first = render(<TeacherStudioDashboard seed={value} />);
    });
    expect(screen.getAllByText("Negotiation Basics").length).toBeGreaterThan(0);
    await act(async () => first.unmount());

    await act(async () => {
      render(<TeacherStudioDashboard seed={value} />);
    });
    expect(screen.queryByText("Negotiation Basics")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Patrick");
  });

  it("a re-read that fails does not replace the products the server just sent with an error", async () => {
    await act(async () => {
      render(<TeacherStudioDashboard seed={seed()} />);
    });

    await act(async () => state.failCourses());
    await act(async () => state.failProfile());

    expect(screen.getAllByText("Negotiation Basics").length).toBeGreaterThan(0);
    expect(screen.queryByText("We could not load your products or sales.")).toBeNull();
    // The gates the server answered stay too.
    expect(screen.getByText("Get ready for your first sale")).toBeTruthy();
  });

  it("without a seed, a failed read is still the error with 'Try again', as before", async () => {
    await act(async () => {
      render(<TeacherStudioDashboard seed={null} />);
    });

    await act(async () => state.failCourses());

    expect(screen.getByText("We could not load your products or sales.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("when the browser reads something newer, that is what stays on screen", async () => {
    const { rowToTeacherCourse } = await import("@/lib/data/published-courses");
    await act(async () => {
      render(<TeacherStudioDashboard seed={seed()} />);
    });

    await act(async () =>
      state.deliverCourses([
        rowToTeacherCourse(courseRow("c1", "Negotiation Basics") as never),
        rowToTeacherCourse(courseRow("c2", "Public Speaking") as never),
      ]),
    );

    expect(screen.getAllByText("Public Speaking").length).toBeGreaterThan(0);
  });
});

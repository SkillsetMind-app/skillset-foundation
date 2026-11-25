import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";

// The promo links are what the creator pastes in an ad, story and bio.
// The third was missing: their public storefront. This file proves the three
// cards exist, that each has the trio of buttons, and that the storefront address
// comes out on the same public base as the product page.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "published",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // The SAME object on every render: a new user per render resubscribes the
    // effects and loops.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("section=links"),
    publicProfile: { username: "ana.souza" } as { username: string | null } | null,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  subscribeToTeacherCourses: (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
    onData([mocks.course]);
    return () => undefined;
  },
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
  getPublicProfile: async () => mocks.publicProfile,
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

// The product panel reads orders, enrollments, coupons and reviews. None of that
// goes into the links section and it has its own tests in course-overview-panel.test.tsx.
vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
}));

// The checklist reads the file list (content in every lesson), like the builder.
vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
}));

afterEach(() => cleanup());

function renderLinks() {
  return render(
    <I18nProvider initialLocale="en">
      <CourseManageHub courseId="course-1" />
    </I18nProvider>,
  );
}

describe("promo links section", () => {
  it("offers checkout, product page and storefront, each with the same three actions", () => {
    renderLinks();

    for (const label of ["Checkout", "Product page", "Storefront"]) {
      expect(screen.getByRole("button", { name: `Copy ${label} link` })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: `Open ${label}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Share ${label}` })).toBeInTheDocument();
    }

    // Three cards, not one more: each card has exactly one "Copy ... link".
    expect(screen.getAllByRole("button", { name: /^Copy .+ link$/ })).toHaveLength(3);
  });

  it("publishes the storefront of the course owner on the same public base as the product page", async () => {
    mocks.publicProfile = null;
    renderLinks();

    // The product page defines the public base; the storefront has to use the same one.
    const productPage = screen
      .getByRole("link", { name: "Open Product page" })
      .getAttribute("href")!;
    const base = productPage.slice(0, productPage.indexOf("/courses/"));
    expect(base).toBe("https://www.skillsetmind.com");

    // No @ on the public profile: the address by uid.
    const storefront = `${base}/instructors/${mocks.course.ownerId}`;
    expect(await screen.findByText(storefront)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Storefront" })).toHaveAttribute(
      "href",
      storefront,
    );
  });

  // The link the creator copies for the Instagram bio is /@user.
  it("uses the creator's @handle when the public profile has one", async () => {
    mocks.publicProfile = { username: "ana.souza" };
    renderLinks();

    expect(await screen.findByText("https://www.skillsetmind.com/@ana.souza")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Storefront" })).toHaveAttribute(
      "href",
      "https://www.skillsetmind.com/@ana.souza",
    );
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));

// The open section only changed color: the screen reader did not know where it was.
describe("manage section nav", () => {
  it("announces the open section with aria-current and only that one", () => {
    renderLinks();
    expect(screen.getByRole("button", { name: "Promo links" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Panel" })).not.toHaveAttribute("aria-current");
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1);
  });
});

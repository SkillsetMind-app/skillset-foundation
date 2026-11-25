import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";

// What the person went through: in the pricing section, the same draft said "Free" in the
// price and "Monthly subscription" in the payment type — and the refund period,
// which weighs most in the purchase decision, did not show up anywhere.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Facilitation fundamentals",
    summary: "A repeatable practice for running productive group sessions.",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status: "draft",
    modules: [],
    lessonCount: 0,
    // The draft from the screenshot: no amount, but with a monthly subscription saved.
    priceAmountMinor: 0,
    currency: "USD",
    paymentType: "subscription_monthly",
  };

  return {
    course,
    user: { uid: "teacher-1", displayName: "Patricia", roles: ["teacher"] },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("section=pricing"),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/teach/courses/course-1/manage",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
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
  deleteOrArchiveCourse: vi.fn(),
  getCourseAudience: () => Promise.resolve({ enrollments: 0, orders: 0, subscriptions: 0 }),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
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

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: () => () => undefined,
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/lib/data/course-commerce", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeToCourseCoupons: (_id: string, onData: (coupons: unknown[]) => void) => {
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("free draft: the payment type does not apply, never 'Monthly subscription'", async () => {
  render(<CourseManageHub courseId="course-1" />);

  const paymentType = await screen.findByText("How people pay");
  const card = paymentType.parentElement as HTMLElement;
  expect(card).toHaveTextContent("—");
  expect(screen.queryByText(/Monthly (subscription|membership)/)).not.toBeInTheDocument();
  // And the price still tells the truth: free.
  expect(screen.getByText("Free")).toBeInTheDocument();
});

it("the refund window shows in the summary, with the days", async () => {
  render(<CourseManageHub courseId="course-1" />);

  const refund = await screen.findByText("Refund window");
  expect(refund.parentElement).toHaveTextContent("7 days");
});

it("pricing has a single visual layer, with no frame around the four summaries", async () => {
  render(<CourseManageHub courseId="course-1" />);

  const pricing = await screen.findByRole("region", { name: "Pricing & checkout" });
  expect(pricing.className).not.toMatch(/border|shadow|rounded/);
  for (const label of ["Price", "How people pay", "Refund window", "Checkout"]) {
    const card = within(pricing).getByText(label).parentElement;
    expect(card).toHaveClass("border-0", "rounded-lg");
    expect(card?.className).not.toContain("shadow");
  }
  expect(within(pricing).getByRole("link", { name: /edit/i })).toHaveAttribute(
    "href", "/teach/builder?courseId=course-1&tab=pricing",
  );
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));

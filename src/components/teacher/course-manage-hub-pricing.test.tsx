import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";

// O que a pessoa sofria: na secao de precos, o mesmo rascunho dizia "Free" no
// preco e "Monthly subscription" no tipo de pagamento — e o prazo de reembolso,
// que e o que mais pesa na decisao de compra, nao aparecia em lugar nenhum.

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
    // O rascunho do print: sem valor, mas com assinatura mensal gravada.
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
  getCourseAudience: () => Promise.resolve({ enrollments: 0, orders: 0 }),
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

it("rascunho gratuito: o tipo de pagamento nao se aplica, nunca 'Monthly subscription'", async () => {
  render(<CourseManageHub courseId="course-1" />);

  const paymentType = await screen.findByText("Payment type");
  const card = paymentType.parentElement as HTMLElement;
  expect(card).toHaveTextContent("—");
  expect(screen.queryByText("Monthly subscription")).not.toBeInTheDocument();
  // E o preco continua dizendo a verdade: gratuito.
  expect(screen.getByText("Free")).toBeInTheDocument();
});

it("o prazo de reembolso aparece no resumo, com os dias", async () => {
  render(<CourseManageHub courseId="course-1" />);

  const refund = await screen.findByText("Refund window");
  expect(refund.parentElement).toHaveTextContent("7 days");
});

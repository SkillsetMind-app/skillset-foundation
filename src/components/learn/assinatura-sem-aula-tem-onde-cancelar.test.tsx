import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * O cartão "Subscription" (com "Cancel subscription") só existia ao lado do
 * currículo. Quem assinava um produto sem aula (uma comunidade, por exemplo)
 * não tinha onde cancelar, e o aviso de renovação manda cancelar na página do
 * curso. Agora o cartão aparece também fora da trilha de aulas.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "buyer-1", email: "buyer@example.test", roles: ["student"] },
  }),
}));

const enrollment = {
  id: "buyer-1__course-1",
  userId: "buyer-1",
  courseId: "course-1",
  courseSlug: "demo-course",
  source: "subscription",
  subscriptionId: "sub_1",
  status: "active",
  progressPercent: 0,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (value: unknown) => void) => {
    onNext(enrollment);
    return vi.fn();
  }),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId: string, onNext: (value: unknown) => void) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// O cartão de verdade lê a assinatura no banco: aqui basta saber que ele veio.
vi.mock("@/components/learn/course-subscription-card", () => ({
  CourseSubscriptionCard: ({ subscriptionId }: { subscriptionId: string }) => (
    <div data-testid="subscription-card">{subscriptionId}</div>
  ),
}));

const lesson = { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: false, contentText: "One" };

function course(modules: unknown[]) {
  return {
    id: "course-1",
    slug: "demo-course",
    title: "Demo course",
    category: "Leadership",
    summary: "A demo course.",
    durationLabel: "2h",
    image: null,
    membersTheme: "light",
    modules,
  } as unknown as Course;
}

describe("assinante sempre tem onde cancelar", () => {
  // jsdom não rola: a sala chama scrollIntoView ao abrir uma aula.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("produto sem aula: o cartão da assinatura aparece na sala", () => {
    const { container } = render(<EnrolledCourseWorkspace course={course([])} />);

    expect(screen.getAllByTestId("subscription-card")).toHaveLength(1);
    expect(container.querySelector("[data-subscription-panel]")).toHaveTextContent("sub_1");
  });

  it("curso com aulas: o cartão segue ao lado do currículo, uma vez só", () => {
    const { container } = render(
      <EnrolledCourseWorkspace course={course([{ id: "m1", title: "Module one", summary: "", lessons: [lesson] }])} />,
    );

    expect(screen.getAllByTestId("subscription-card")).toHaveLength(1);
    expect(container.querySelector("[data-subscription-panel]")).toBeNull();
  });
});

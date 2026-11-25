import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * The "Subscription" card (with "Cancel subscription") only existed next to the
 * curriculum. Someone who subscribed to a product with no lessons (a community,
 * for example) had nowhere to cancel, and the renewal notice tells them to cancel on the
 * course page. Now the card also appears outside the lesson track.
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

// The real card reads the subscription from the database: here it is enough to know it showed up.
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

describe("a subscriber always has somewhere to cancel", () => {
  // jsdom does not scroll: the classroom calls scrollIntoView when it opens a lesson.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("product without lessons: the subscription card appears in the classroom", () => {
    const { container } = render(<EnrolledCourseWorkspace course={course([])} />);

    expect(screen.getAllByTestId("subscription-card")).toHaveLength(1);
    expect(container.querySelector("[data-subscription-panel]")).toHaveTextContent("sub_1");
  });

  it("course with lessons: the card stays next to the curriculum, only once", () => {
    const { container } = render(
      <EnrolledCourseWorkspace course={course([{ id: "m1", title: "Module one", summary: "", lessons: [lesson] }])} />,
    );

    expect(screen.getAllByTestId("subscription-card")).toHaveLength(1);
    expect(container.querySelector("[data-subscription-panel]")).toBeNull();
  });
});

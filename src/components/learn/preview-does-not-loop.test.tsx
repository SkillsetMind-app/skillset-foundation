import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * The teacher opens the preview of their own course and the tab hammers the database nonstop.
 *
 * The preview enrollment is built as a literal in the component body, so it
 * got a new identity on every render. Three effects declare that OBJECT as a
 * dependency, and two of them open a Supabase subscription and write state in the
 * callback: new state -> render -> new object -> cancel and resubscribe ->
 * callback -> new state. A closed loop, with no stop condition.
 *
 * Real cost: the project request quota, realtime channel churn, a tab
 * freezing and the phone battery draining. Nothing on the screen said what it was.
 *
 * The contract proved here: in the preview, each subscription is opened ONCE.
 */

const mocks = vi.hoisted(() => ({
  subscribeToLessonContent: vi.fn(),
  subscribeToCourseAssets: vi.fn(),
  subscribeToEnrollment: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/teach/courses/demo/preview",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.com", roles: ["teacher"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: mocks.subscribeToLessonContent,
  resolveLessonContent: vi.fn(() => null),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: mocks.subscribeToCourseAssets,
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  modules: [],
  membersTheme: "light",
} as unknown as Course;

// With the defect back, the loop is SYNCHRONOUS inside the render: the test does not
// "fail", it hangs forever (that is exactly what happened in the proof by
// reversal). A fuse turns the hang into a failure that ends.
const FUSIVEL = 20;

function withFuse<T>(rotulo: string, entrega: T) {
  let vezes = 0;
  return (_courseId: string, onNext: (value: T) => void) => {
    vezes += 1;
    if (vezes > FUSIVEL) {
      throw new Error(`loop: ${rotulo} resubscribed ${vezes} times`);
    }
    onNext(entrega);
    return vi.fn();
  };
}

describe("the teacher's course preview must not enter a loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real failure mode: the subscription delivers the current state RIGHT when
    // subscribing. It is writing that state that closes the loop.
    mocks.subscribeToLessonContent.mockImplementation(
      withFuse("lesson content", new Map()),
    );
    mocks.subscribeToCourseAssets.mockImplementation(
      withFuse("attachments", [] as unknown[]),
    );
    mocks.subscribeToEnrollment.mockImplementation((_uid, _slug, onNext) => {
      onNext(null);
      return vi.fn();
    });
  });

  it("opens the lesson content subscription only once", () => {
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(1);
  });

  it("opens the attachments subscription only once", () => {
    render(
      <EnrolledCourseWorkspace course={course} previewMode enableFirestoreAssets />,
    );

    expect(mocks.subscribeToCourseAssets).toHaveBeenCalledTimes(1);
  });

  it("does not resubscribe when the component is rendered again with the same props", () => {
    const { rerender } = render(
      <EnrolledCourseWorkspace course={course} previewMode />,
    );

    rerender(<EnrolledCourseWorkspace course={course} previewMode />);
    rerender(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(1);
  });
});

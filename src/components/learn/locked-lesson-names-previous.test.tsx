import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * A lesson locked by the sequential order only said "Complete the previous lesson to
 * unlock": the learner had to figure out on their own which one was the previous lesson. Now the screen says
 * the lesson's name and has a button that takes them to it.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.test", roles: ["teacher"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn(() => vi.fn()),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
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

// Sequential: lesson 2 only opens once lesson 1 is completed.
const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  dripStrategy: "sequential_progress",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: false, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

// The open lesson's title is the h2 in the panel header, inside the player.
function playerHeading() {
  return document
    .getElementById("member-lesson-player")
    ?.querySelector(".member-lesson-panel__head h2")?.textContent;
}

describe("the locked lesson says which lesson to finish", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("shows the name of the previous lesson and the button takes you to it", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson two");
    expect(screen.getByText('Finish "Lesson one" first')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to that lesson" }));

    expect(playerHeading()).toBe("Lesson one");
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.stringMatching(/\/learn\/courses\/demo-course\?.*lesson=l1/),
      { scroll: false },
    );
  });
});

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";
import { resolveLessonContent } from "@/lib/data/lesson-content";

/**
 * A lesson with no cover of its own (lesson_thumbnail) and with a YouTube link showed up with no
 * thumbnail in the playlist. Now the classroom uses YouTube's own cover
 * (i.ytimg.com/vi/<id>/hqdefault.jpg), only for the OPEN lesson: a locked
 * lesson's link never reaches the page, and the classroom does not invent a cover for it.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

// The lesson's text and link arrive by the same path as the real classroom
// (resolveLessonContent); only the database subscription is stubbed.
// resolveLessonContent is the real one wrapped in a vi.fn: one test forces the
// null that the teacher's preview receives in preview-tabs.test.tsx.
vi.mock("@/lib/data/lesson-content", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/lesson-content")>();
  return {
    ...original,
    resolveLessonContent: vi.fn(original.resolveLessonContent),
    subscribeToLessonContent: vi.fn((_courseId, onNext) => {
      onNext(new Map());
      return vi.fn();
    }),
  };
});

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn((_courseId, onNext) => {
    onNext([]);
    return vi.fn();
  }),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Sequential: lesson 1 open, lesson 2 locked. Both with a YouTube link and
// neither with a cover of its own.
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
        {
          id: "l1",
          title: "Lesson one",
          type: "video",
          videoSource: "youtube",
          duration: "5 min",
          isPreview: false,
          externalUrl: "https://youtu.be/openVideo01",
        },
        {
          id: "l2",
          title: "Lesson two",
          type: "video",
          videoSource: "youtube",
          duration: "7 min",
          isPreview: false,
          externalUrl: "https://youtu.be/lockedVid02",
        },
      ],
    },
  ],
} as unknown as Course;

describe("the lesson cover falls back to the YouTube one", () => {
  beforeEach(() => {
    // Back to the real resolveLessonContent between tests.
    vi.mocked(resolveLessonContent).mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("an open lesson without a cover uses the YouTube one; the locked one gets none", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    render(<EnrolledCourseWorkspace course={course} previewMode enableFirestoreAssets />);

    expect(
      document.querySelector('img[src="https://i.ytimg.com/vi/openVideo01/hqdefault.jpg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src*="lockedVid02"]')).toBeNull();
  });

  // preview-tabs.test.tsx stubs resolveLessonContent to return null; the cover
  // fallback read .externalUrl from it and took down the whole preview classroom.
  it("in preview, null content does not crash the classroom or invent a cover", () => {
    vi.mocked(resolveLessonContent).mockReturnValue(
      null as unknown as ReturnType<typeof resolveLessonContent>,
    );
    mocks.searchParams = new URLSearchParams("lesson=l1");

    expect(() =>
      render(<EnrolledCourseWorkspace course={course} previewMode enableFirestoreAssets />),
    ).not.toThrow();
    expect(document.querySelector('img[src*="i.ytimg.com"]')).toBeNull();
  });
});

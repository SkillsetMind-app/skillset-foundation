import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";

/**
 * The selected lesson was not in the address: reloading the page or going back in
 * the browser opened the "first unfinished lesson", not the one the person was
 * viewing; a shared link never opened the same lesson. And the lesson switch
 * could happen off screen (the learner scrolled down to the discussion, the video
 * ended, the next lesson came in up there).
 *
 * Contract: ?lesson=<id> opens that lesson; every selection writes the address and
 * scrolls to the player; changing the address from outside (back/forward) changes the lesson.
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
    user: { uid: "teacher-1", email: "teacher@example.com", roles: ["teacher"] },
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

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: true, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

// The title of the open lesson is the h2 of the lesson panel header, inside the
// player (the section has other h4s: the "continue" card, the lesson list).
function playerHeading() {
  return document
    .getElementById("member-lesson-player")
    ?.querySelector(".member-lesson-panel__head h2")?.textContent;
}

describe("the current lesson lives in the address", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    mocks.replace.mockReset();
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom without requestAnimationFrame in some environments: run it right away.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("opens the lesson from ?lesson= instead of the first one", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson two");
  });

  it("when a lesson is chosen, writes the address and scrolls to the player", () => {
    mocks.searchParams = new URLSearchParams();
    render(<EnrolledCourseWorkspace course={course} previewMode />);
    expect(playerHeading()).toBe("Lesson one");

    fireEvent.click(screen.getByRole("button", { name: /Lesson two/ }));

    expect(playerHeading()).toBe("Lesson two");
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.stringMatching(/\/learn\/courses\/demo-course\?.*lesson=l2/),
      { scroll: false },
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });

  // The Stripe return marker must not survive a lesson switch: every lesson link
  // copied or reopened would count another purchase.
  it("when switching lessons, removes ?checkout from the address and keeps the rest", () => {
    mocks.searchParams = new URLSearchParams("checkout=success&campaign=literal");
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    fireEvent.click(screen.getByRole("button", { name: /Lesson two/ }));

    const [url] = mocks.replace.mock.calls.at(-1)!;
    expect(url).toMatch(/lesson=l2/);
    expect(url).toMatch(/campaign=literal/);
    expect(url).not.toMatch(/checkout/);
  });

  it("going back in the browser (address changes from outside) changes the lesson", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    const { rerender } = render(
      <EnrolledCourseWorkspace course={course} previewMode />,
    );
    expect(playerHeading()).toBe("Lesson two");

    mocks.searchParams = new URLSearchParams("lesson=l1");
    rerender(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson one");
  });
});

// The duration is no longer typed in (September 14 decision): most lessons arrive
// with the "Self-paced" fallback from published-courses. The clock only shows up with
// a real duration.
describe("lesson clock only with a duration", () => {
  function lessonClock() {
    return document
      .getElementById("member-lesson-player")
      ?.querySelector(".member-lesson-panel__head .member-meta-chip") ?? null;
  }

  beforeEach(() => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
  });

  it("a lesson without a duration does not show the clock", () => {
    const [lesson] = course.modules[0].lessons;
    const withoutDuration = {
      ...course,
      modules: [{ ...course.modules[0], lessons: [{ ...lesson, duration: "Self-paced" }] }],
    } as Course;
    render(<EnrolledCourseWorkspace course={withoutDuration} previewMode />);

    expect(playerHeading()).toBe("Lesson one");
    expect(lessonClock()).toBeNull();
  });

  it("a lesson with a duration shows the clock", () => {
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(lessonClock()).toHaveTextContent("5 min");
  });
});

// A new lesson is born as "video" and the type can no longer be changed (September 14 decision). Without
// a video, the player notice follows the content: a reading lesson cannot say
// "Media not attached yet".
// September 14 decision: the lesson text is plain, and links become clickable in the
// members area without raw HTML. The teacher's line breaks are kept.
describe("lesson text with links", () => {
  it("becomes a clickable link and keeps the line break", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    const withLink = {
      ...course,
      modules: [
        {
          ...course.modules[0],
          lessons: [
            { id: "l1", title: "Leitura", type: "video", duration: "Self-paced", isPreview: true, contentText: "linha 1\nveja https://a.com/x.", description: "" },
          ],
        },
      ],
    } as unknown as Course;
    render(<EnrolledCourseWorkspace course={withLink} previewMode />);

    const body = document.getElementById("member-lesson-content") as HTMLElement;
    const link = body.querySelector('a[href="https://a.com/x"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent("https://a.com/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(body.textContent).toContain("linha 1\nveja https://a.com/x.");
  });
});

describe("player notice without a video follows the content, not the type", () => {
  function playerNotice() {
    return document
      .getElementById("member-lesson-player")
      ?.querySelector(".member-video-empty h3")?.textContent;
  }

  const withoutVideo = {
    ...course,
    modules: [
      {
        ...course.modules[0],
        lessons: [
          { id: "l1", title: "Leitura", type: "video", duration: "Self-paced", isPreview: true, contentText: "leia isto", description: "" },
          { id: "l2", title: "Vazia", type: "video", duration: "Self-paced", isPreview: false, contentText: null, description: "" },
          { id: "l3", title: "Video pendente", type: "video", duration: "Self-paced", isPreview: false, contentText: null, description: "Resumo curto" },
        ],
      },
    ],
  } as unknown as Course;

  // Before: an empty video box of 260-520px saying "read the notes
  // below". A reading lesson has no video box; the text comes right away.
  it("a text-only lesson has no empty video box", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    render(<EnrolledCourseWorkspace course={withoutVideo} previewMode />);

    expect(playerHeading()).toBe("Leitura");
    expect(playerNotice()).toBeUndefined();
    expect(document.querySelector("#member-lesson-player .member-video-stage")).toBeNull();
    expect(screen.getByText("leia isto")).toBeInTheDocument();
  });

  it("a lesson with no video and no text keeps the media notice", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={withoutVideo} previewMode />);

    expect(playerHeading()).toBe("Vazia");
    expect(playerNotice()).toBe("Media not attached yet");
  });

  // Almost every video lesson has a summary line: the summary must not
  // turn "video not uploaded yet" into a "reading lesson".
  it("a video lesson with a summary and no media keeps the media notice", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    render(<EnrolledCourseWorkspace course={withoutVideo} previewMode />);

    expect(playerHeading()).toBe("Video pendente");
    expect(playerNotice()).toBe("Media not attached yet");
  });

  // While the lesson attachments have not arrived, the notice is a loading one: before, the
  // video lesson flashed "Media not attached yet" until the player showed up.
  it("with attachments still loading, shows loading, not missing media", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    // The default mock never responds: the attachments subscription stays pending.
    render(<EnrolledCourseWorkspace course={withoutVideo} previewMode enableFirestoreAssets />);

    expect(playerNotice()).toBe("Loading lesson content...");
  });

  it("after the attachments arrive empty, shows missing media", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    vi.mocked(subscribeToCourseAssets).mockImplementation((_courseId, onAssets) => {
      onAssets([]);
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    try {
      render(<EnrolledCourseWorkspace course={withoutVideo} previewMode enableFirestoreAssets />);

      expect(playerNotice()).toBe("Media not attached yet");
    } finally {
      vi.mocked(subscribeToCourseAssets).mockImplementation(() =>
        Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) }),
      );
    }
  });
});

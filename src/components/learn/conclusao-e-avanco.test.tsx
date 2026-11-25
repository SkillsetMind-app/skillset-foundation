import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * Completing the lesson and moving on to the next one, by both paths: the end of the video
 * and the fixed button under the lesson.
 *
 *   - If saving the completion fails, nothing advances. Before, the "Next lesson" card
 *     showed up anyway and, in a sequential course, the next one opened locked and
 *     o servidor negava o video.
 *   - The button is an explicit request: it goes straight to the next one, without the 5 s
 *     countdown (which stays for the end of the video).
 *   - On the last completed lesson, the dead "Completed" button becomes "Get
 *     certificate".
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  completed: [] as string[],
  // The completed list arrives again through realtime: the test re-emits it.
  emitCompleted: null as null | ((lessonIds: string[]) => void),
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (enrollment: unknown) => void) => {
    onNext({
      id: "enr-1",
      userId: "student-1",
      courseId: "course-1",
      courseSlug: "demo-course",
      courseTitle: "Demo course",
      courseCategory: "Leadership",
      courseImage: "",
      status: "active",
      source: "admin",
      progressPercent: 0,
      lastLessonId: null,
    });
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(
    (_enrollmentId: string, onNext: (lessonIds: string[]) => void) => {
      mocks.emitCompleted = onNext;
      onNext(mocks.completed);
      return vi.fn();
    },
  ),
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

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// The end of the video, without an iframe: a button that fires the same onEnded.
vi.mock("@/components/learn/trusted-embed-player", () => ({
  TrustedEmbedPlayer: ({ onEnded }: { onEnded: () => void }) => (
    <button type="button" onClick={onEnded}>End video</button>
  ),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
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
          id: "l1", title: "Lesson one", type: "video", duration: "5 min", isPreview: false,
          videoSource: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

function open(lessonId: string, completed: string[] = [], props: { whitelabel?: boolean } = {}) {
  mocks.searchParams = new URLSearchParams(`lesson=${lessonId}`);
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function lessonBar() {
  return screen.getByRole("navigation", { name: "Lesson navigation" });
}

function playlist() {
  return screen.getByRole("navigation", { name: "Lessons" });
}

describe("complete and move on to the next lesson", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    vi.mocked(recordLessonProgress).mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("end of the video with the completion NOT saved: no next lesson card, a notice on screen and the lesson stays", async () => {
    vi.mocked(recordLessonProgress).mockRejectedValue(new Error("network"));
    open("l1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });

    expect(recordLessonProgress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Next lesson" })).not.toBeInTheDocument();
    expect(screen.getByText("We could not update lesson progress. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End video" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();

    // Switching lessons takes the notice along: it belonged to the previous lesson.
    fireEvent.click(within(playlist()).getByRole("button", { name: /Lesson two/ }));
    expect(screen.queryByText("We could not update lesson progress. Please try again.")).not.toBeInTheDocument();
  });

  it("end of the video with the completion saved: the 5 s card offers the next one", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 50, completedLessonCount: 1 } as never);
    open("l1");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });

    expect(screen.getByRole("region", { name: "Next lesson" })).toBeInTheDocument();
  });

  it("button with the completion NOT saved: does not switch lessons", async () => {
    vi.mocked(recordLessonProgress).mockRejectedValue(new Error("network"));
    open("l1");

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Mark complete & next" }));
    });

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText("We could not update lesson progress. Please try again.")).toBeInTheDocument();
  });

  it("button with the completion saved: goes straight to the next one, with no countdown", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 50, completedLessonCount: 1 } as never);
    open("l1");

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Mark complete & next" }));
    });

    expect(mocks.replace).toHaveBeenCalledWith("/learn/courses/demo-course?lesson=l2", { scroll: false });
    expect(screen.queryByRole("region", { name: "Next lesson" })).not.toBeInTheDocument();
    // Sequential course: the next one opens already unlocked, without waiting for realtime
    // to bring the completion (the mock does not resend the list).
    expect(screen.queryByRole("heading", { name: "Lesson locked" })).not.toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });

  it("switching lessons with the countdown pending cancels the countdown", async () => {
    vi.mocked(recordLessonProgress).mockResolvedValue({ progressPercent: 33, completedLessonCount: 1 } as never);
    const video = (id: string, title: string) => ({
      id, title, type: "video", duration: "5 min", isPreview: false,
      videoSource: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={{ ...course, dripStrategy: undefined, modules: [{
      ...course.modules[0], lessons: [video("l1", "Lesson one"), video("l2", "Lesson two"), video("l3", "Lesson three")],
    }] } as unknown as Course} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End video" }));
    });
    expect(screen.getByRole("region", { name: "Next lesson" })).toBeInTheDocument();

    fireEvent.click(within(playlist()).getByRole("button", { name: /Lesson three/ }));
    expect(screen.queryByRole("region", { name: "Next lesson" })).not.toBeInTheDocument();
  });

  it("already completed lesson: 'Next lesson' goes straight, without saving again and with no countdown", async () => {
    open("l1", ["l1"]);

    await act(async () => {
      fireEvent.click(within(lessonBar()).getByRole("button", { name: "Next lesson" }));
    });

    expect(recordLessonProgress).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/learn/courses/demo-course?lesson=l2", { scroll: false });
    expect(screen.queryByRole("region", { name: "Next lesson" })).not.toBeInTheDocument();
  });

  it("last lesson completed: 'Get certificate' leads to the certificate, without the dead 'Completed' button", () => {
    open("l2", ["l1", "l2"]);

    expect(within(lessonBar()).getByRole("link", { name: "Get certificate" })).toHaveAttribute(
      "href",
      "/learn/credentials",
    );
    expect(within(lessonBar()).queryByRole("button", { name: "Completed" })).not.toBeInTheDocument();
  });

  it("whitelabel: on the last lesson nothing leads back to the platform, and 'Completed' does not pretend to be an action", () => {
    open("l2", ["l1", "l2"], { whitelabel: true });

    expect(within(lessonBar()).queryByRole("link", { name: "Get certificate" })).not.toBeInTheDocument();
    expect(within(lessonBar()).getByRole("button", { name: "Completed" })).toBeDisabled();
  });

  // Drip by deadline: completing this one does not open the next. The button said "Next
  // lesson" and the click did nothing, without saying why.
  it("next lesson locked by date: the button says when it opens and is disabled", () => {
    const timeDrip = { ...course, dripStrategy: "time_drip_lesson", dripIntervalDays: 1 } as Course;
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    const { unmount } = render(<EnrolledCourseWorkspace course={timeDrip} />);
    // Before completing: "Mark complete", without promising "& next".
    expect(within(lessonBar()).getByRole("button", { name: "Mark complete" })).toBeEnabled();
    unmount();

    mocks.completed = ["l1"];
    render(<EnrolledCourseWorkspace course={timeDrip} />);
    const button = within(lessonBar()).getByRole("button", { name: /^Next lesson · Unlocks / });
    expect(button).toBeDisabled();
  });
});

// Wave D in the classroom: the lesson's check, the 100% badge and the tab panel only
// move on CHANGE. Whoever arrives sees everything still (and what becomes the LCP is never born
// with opacity 0).
describe("classroom motion: only on change", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const checks = () => [...playlist().querySelectorAll("[data-drawn-check]")];

  it("arriving with the lessons completed: check and 100% badge stay still", () => {
    open("l2", ["l1", "l2"]);
    expect(checks()).toHaveLength(2);
    expect(playlist().querySelector(".drawn-check")).toBeNull();
    const seal = document.querySelector("[data-milestone-seal]");
    expect(seal).not.toBeNull();
    expect(seal).not.toHaveClass("milestone-seal");
  });

  it("completing with the classroom open: that lesson's check is drawn and the 100% badge grows", () => {
    open("l2", ["l1"]);
    expect(document.querySelector("[data-milestone-seal]")).toBeNull();

    act(() => mocks.emitCompleted!(["l1", "l2"]));
    const drawing = playlist().querySelectorAll(".drawn-check");
    expect(drawing).toHaveLength(1);
    expect(drawing[0].closest("li")).toHaveTextContent("Lesson two");
    expect(document.querySelector("[data-milestone-seal]")).toHaveClass("milestone-seal");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("the complete button is the button-solid, which sinks when pressed", () => {
    open("l1");
    expect(within(lessonBar()).getByRole("button", { name: "Mark complete & next" })).toHaveClass("button-solid");
  });

  it("a fresh load enters still; only switching tabs animates", async () => {
    vi.resetModules();
    const { useTabChanged } = await import("@/components/learn/classroom-tabs");
    const load = renderHook(() => useTabChanged("lesson"));
    expect(load.result.current).toBe(false);
    load.unmount();
    const change = renderHook(() => useTabChanged("about"));
    expect(change.result.current).toBe(true);
    change.unmount();
    const same = renderHook(() => useTabChanged("about"));
    expect(same.result.current).toBe(false);
  });

  it("on a tab switch only the tab panel slides up: title and tabs stay still", () => {
    const first = open("l1");
    first.unmount();
    render(<EnrolledCourseWorkspace course={course} tab="about" />);
    const panel = document.querySelector(".motion-panel-in");
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("h1")).toBeNull();
    expect(panel!.querySelector(".member-classroom-tabs")).toBeNull();
    expect(document.querySelector(".motion-panel-in .motion-panel-in")).toBeNull();
  });
});

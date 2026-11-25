import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { Course } from "@/domain/learning";
import type { CourseAsset } from "@/domain/course-asset";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";
import { recordLessonProgress, subscribeToCompletedLessons } from "@/lib/data/lesson-progress";

// The subscriptions return the unsubscribe function with `reload` (the "Try again").
const unsubscribable = () => Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });

/**
 * P2/P4 of the Hotmart parity (§4.2 and §4.3 of the 2026-09-06 report):
 *   - previous / next next to the lesson title, only once, without bypassing the
 *     lock;
 *   - "Now playing" in the playlist, only on the current item;
 *   - "Lesson information" is gone: type, duration, module and files are already
 *     on screen, each one once;
 *   - "N de M aulas · X%" e "Ver certificado" (so a 100%) no hero da home.
 *
 * Its own file: classroom-home.test.tsx is already heavy and a big file
 * blows up the RAM. The mocks are the SAME as there — especially the single `auth`
 * per session (a new object per render re-subscribes the enrollment in a loop).
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  pathname: "/learn/courses/demo-course",
  replace: vi.fn(),
  completed: [] as string[],
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
  enrollmentSubscriptions: 0,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((...args: unknown[]) => {
    // Fuse: a subscription loop is synchronous inside render — not even the
    // vitest timeout reaches it. It becomes a failure that ends, not a hang.
    mocks.enrollmentSubscriptions += 1;
    if (mocks.enrollmentSubscriptions > 20) {
      throw new Error("subscribeToEnrollment called more than 20 times: render loop");
    }
    const onNext = args.find((arg) => typeof arg === "function") as (
      enrollment: unknown,
    ) => void;
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
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(() => Promise.resolve()),
  subscribeToCompletedLessons: vi.fn(
    (_enrollmentId: string, onNext: (lessonIds: string[]) => void) => {
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

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock("@/components/learn/course-messages-panel", () => ({
  CourseMessagesPanel: () => <div data-testid="messages-panel" />,
}));
vi.mock("@/components/learn/course-review-panel", () => ({
  CourseReviewPanel: () => <div data-testid="review-panel" />,
}));
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <div data-testid="community-feed" />,
}));
// The lesson attachment opens a protected preview (signed URL). It is not the target
// daqui: so a contagem importa.
vi.mock("@/components/shared/protected-asset-preview", () => ({
  ProtectedAssetPreview: () => null,
  ProtectedAssetDownload: () => null,
}));

// Three lessons in two modules: it is possible to test "first" (no previous),
// "last" (no next) and the module change in the middle.
const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "dark",
  communityEnabled: false,
  instructorId: "teacher-1",
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
    {
      id: "m2",
      title: "Module two",
      summary: "",
      lessons: [
        { id: "l3", title: "Lesson three", type: "text", duration: "9 min", isPreview: false, contentText: "Three" },
      ],
    },
  ],
} as unknown as Course;

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderClassroom(
  search: string,
  completed: string[] = [],
  props: Partial<Parameters<typeof EnrolledCourseWorkspace>[0]> = {},
) {
  const tab: ClassroomTab = props.tab ?? "lesson";
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname =
    tab === "lesson" ? "/learn/courses/demo-course" : `/learn/courses/demo-course/${tab}`;
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function head() {
  const element = document.querySelector(".member-classroom-head");
  if (!element) throw new Error("the lesson's short header did not render");
  return element as HTMLElement;
}

function playlist() {
  return screen.getByRole("navigation", { name: "Lessons" });
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.pathname = "/learn/courses/demo-course";
  mocks.enrollmentSubscriptions = 0;
  vi.mocked(recordLessonProgress).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

describe("previous / next next to the title", () => {
  it("switches lesson from the header, writes the lesson to the address and moves the playlist highlight", () => {
    renderClassroom("lesson=l1");

    const previous = within(head()).getByRole("button", { name: "Previous lesson" });
    const next = within(head()).getByRole("button", { name: "Next lesson: Lesson two" });
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toHaveAttribute("aria-disabled");

    // Disabled is not "gone": it stays focusable, it just does nothing.
    fireEvent.click(previous);
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(next);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "/learn/courses/demo-course?lesson=l2",
      { scroll: false },
    );
    expect(within(playlist()).getByRole("button", { name: /Lesson two/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // On lesson 2 both neighbors exist — including the next one, which is in the
    // other module (the order is the whole course's, not the module's).
    expect(within(head()).getByRole("button", { name: "Previous lesson: Lesson one" })).not.toHaveAttribute("aria-disabled");
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).not.toHaveAttribute("aria-disabled");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("never bypasses the lock: the locked next one stays disabled and the click opens nothing", () => {
    renderClassroom("lesson=l1", [], { course: { ...course, dripStrategy: "sequential_progress" } });

    const next = within(head()).getByRole("button", { name: "Next lesson: Lesson two" });
    expect(next).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(next);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(within(playlist()).getByRole("button", { name: /Lesson one/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("on the last lesson 'next' is disabled, and the loose 'previous' in the bottom bar is gone", () => {
    renderClassroom("lesson=l3", ["l1", "l2"]);

    expect(within(head()).getByRole("button", { name: "Next lesson" })).toHaveAttribute("aria-disabled", "true");
    expect(within(head()).getByRole("button", { name: "Previous lesson: Lesson two" })).not.toHaveAttribute("aria-disabled");
    // Only one "previous" in the whole classroom (before: another, with "← title", under the video).
    expect(screen.getAllByRole("button", { name: /^Previous lesson/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^← / })).toBeNull();
  });

  it("outside the lesson tab the header has no arrows (they switch the lesson, not the tab)", () => {
    renderClassroom("lesson=l2", [], { tab: "review" });

    expect(within(head()).queryByRole("button", { name: /lesson/i })).toBeNull();
  });
});

describe("Now playing in the playlist", () => {
  it("only on the current item, in EN and ES, keeping aria-current and without resubscribing", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );

    const list = playlist();
    expect(within(list).getAllByText("Playing now")).toHaveLength(1);
    const current = list.querySelector(".member-playlist__lesson.is-current") as HTMLElement;
    expect(within(current).getByText("Playing now")).toBeInTheDocument();
    expect(within(current).getByRole("button", { name: /Lesson two/ })).toHaveAttribute("aria-current", "true");
    expect(within(list).getByRole("button", { name: /Lesson one/ })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(list).getAllByText("Reproduciendo ahora")).toHaveLength(1);
    expect(within(list).queryByText("Playing now")).toBeNull();
    expect(within(current).getByRole("button", { name: /Lesson two/ })).toHaveAttribute("aria-current", "true");
    expect(mocks.enrollmentSubscriptions).toBe(1);
  });
});

// "Lesson information" repeated what is already on screen: the type (the panel's
// superscript), the duration (the chip), the module (the lesson list) and the files (the
// body list). It is gone; each piece of information stays once, in its own place.
describe("lesson information without repetition", () => {
  it("type, duration and module appear once, without the 'Lesson information' panel", () => {
    renderClassroom("lesson=l2");

    expect(screen.queryByRole("button", { name: "Lesson information" })).toBeNull();
    expect(document.getElementById("member-lesson-info")).toBeNull();
    // O tipo: so o sobrescrito do painel.
    expect(screen.getAllByText("Text lesson")).toHaveLength(1);
    // The duration: the chip in the panel header.
    expect(document.querySelector(".member-lesson-panel__head .member-meta-chip")).toHaveTextContent("7 min");
    // The module: in the lesson list.
    expect(within(playlist()).getByText("Module one")).toBeInTheDocument();
    // With no date-based drip, nothing talks about unlocking.
    expect(screen.queryByText("Available from")).toBeNull();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("with course files, counts only the lesson's materials (thumbnail does not count)", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
    const asset = (patch: Partial<CourseAsset>): CourseAsset => ({
      id: "file", courseId: course.id, ownerId: "teacher-1", lessonId: "l2",
      kind: "lesson_material", fileName: "Worksheet.pdf", contentType: "application/pdf",
      size: 512, storagePath: "courses/course-1/assets/file.pdf", isPreview: false, ...patch,
    });
    act(() => emit([
      asset({}),
      asset({ id: "thumb", kind: "lesson_thumbnail", fileName: "thumb.png", contentType: "image/png" }),
      asset({ id: "other-lesson", lessonId: "l1" }),
    ]));

    // Only this lesson's material, once, in the body list (the thumbnail and the
    // other lesson's file stay out); no repeated count.
    const body = document.getElementById("member-lesson-content") as HTMLElement;
    expect(within(body).getAllByText("Worksheet.pdf")).toHaveLength(1);
    expect(within(body).queryByText("thumb.png")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lesson information" })).toBeNull();
  });
});

describe("course home hero", () => {
  it("shows 'N of M lessons · X%' and the certificate only at 100%; without counts it stays as it was", () => {
    const { rerender, container } = render(
      <MembersAreaHero theme="dark" title="Course" progressPercent={25}
        completedCount={3} totalCount={12} certificateHref="/learn/credentials" />,
    );
    expect(screen.getByText("3 of 12 lessons · 25%")).toBeInTheDocument();
    // The cover's bar is announced as a progress bar.
    expect(screen.getByRole("progressbar", { name: "25% complete" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.queryByRole("link", { name: "Get certificate" })).toBeNull();

    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={100}
        completedCount={12} totalCount={12} certificateHref="/learn/credentials" />,
    );
    expect(screen.getByText("12 of 12 lessons · 100%")).toBeInTheDocument();
    // The same label on the tab bar and on the last lesson's button.
    expect(screen.getByRole("link", { name: "Get certificate" })).toHaveAttribute("href", "/learn/credentials");

    // With no destination (whitelabel) nothing shows, even at 100%.
    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={100}
        completedCount={12} totalCount={12} />,
    );
    expect(screen.queryByRole("link", { name: "Get certificate" })).toBeNull();

    // Without the counts: identical to today's.
    rerender(<MembersAreaHero theme="dark" title="Course" progressPercent={42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(container.querySelector(".members-hero__cta")).toBeNull();
  });

  it("in the classroom, the hero reads the already computed progress and the certificate reuses /learn/credentials", () => {
    const { unmount } = renderClassroom("");
    expect(screen.getByText("0 of 3 lessons · 0%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Get certificate" })).toBeNull();
    unmount();

    renderClassroom("lesson=l3", ["l1", "l2", "l3"], { tab: "about" });
    expect(screen.getByText("3 of 3 lessons · 100%")).toBeInTheDocument();
    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).getByRole("link", { name: "Get certificate" })).toHaveAttribute("href", "/learn/credentials");
    // Only once on the cover: the tab bar does not repeat the hero's certificate.
    expect(screen.getAllByRole("link", { name: "Get certificate" })).toHaveLength(1);
    // Finished: the main action is the certificate, not "continue".
    expect(within(hero).queryByRole("link", { name: /^Continue/ })).toBeNull();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  // The course cover had no main action: the person saw the title, description
  // and progress, and had to find the lesson on their own.
  it("first visit: 'Start lesson 1' opens the first lesson", () => {
    renderClassroom("");

    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).getByRole("link", { name: "Start lesson 1" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l1",
    );
  });

  it("with progress, on the About tab: 'Continue: <lesson>' opens the lesson the person was on", () => {
    renderClassroom("lesson=l2", ["l1"], { tab: "about" });

    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).getByRole("link", { name: "Continue: Lesson two" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
  });

  it("before progress arrives, the cover does not guess 'Start lesson 1' for someone who already started", () => {
    let emit!: (lessonIds: string[]) => void;
    vi.mocked(subscribeToCompletedLessons).mockImplementationOnce((_id, onNext) => {
      emit = onNext;
      return unsubscribable();
    });
    renderClassroom("lesson=l2", [], { tab: "about" });

    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).queryByRole("link", { name: /^(Start lesson 1|Continue)/ })).toBeNull();

    act(() => emit(["l1"]));
    expect(within(hero).getByRole("link", { name: "Continue: Lesson two" })).toBeInTheDocument();
  });

  it("whitelabel: no certificate in the hero even at 100% (nothing leads back to the platform)", () => {
    renderClassroom("lesson=l3", ["l1", "l2", "l3"], { tab: "about", whitelabel: true });

    expect(screen.getByText("3 of 3 lessons · 100%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /certificate/i })).toBeNull();
  });

  // The members area title is the cover's greeting; many teachers put their
  // own name there, and the whole classroom never said which course it was.
  it("with its own title on the cover, the course name shows on the cover and in the lesson header", () => {
    const named = { ...course, membersTitle: "Patrick Simon" } as Course;
    const { unmount } = renderClassroom("", [], { course: named });
    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent("Patrick Simon");
    expect(within(hero).getByText("Demo course")).toBeInTheDocument();
    unmount();

    renderClassroom("lesson=l2", ["l1"], { course: named });
    expect(within(head()).getByRole("heading", { level: 1 })).toHaveTextContent("Demo course");
    expect(screen.queryByText("Patrick Simon")).toBeNull();
  });

  it("the teacher's subtitle stays in its place", () => {
    renderClassroom("", [], { course: { ...course, membersTitle: "Patrick Simon", membersSubtitle: "Live cohort" } as Course });
    const hero = document.querySelector(".members-hero") as HTMLElement;
    expect(within(hero).getByText("Live cohort")).toBeInTheDocument();
  });
});

describe("EN <-> ES with the classroom open", () => {
  it("translates arrows, badge and information without switching lessons, closing the panel or re-subscribing", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );

    const eyebrow = screen.getByText("Text lesson");
    const list = playlist();
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(head()).getByRole("button", { name: "Siguiente lección: Lesson three" })).toBeInTheDocument();
    expect(within(head()).getByRole("button", { name: "Lección anterior: Lesson one" })).toBeInTheDocument();
    // The same element, translated: the lesson was not remounted.
    expect(screen.getByText("Lección de texto")).toBe(eyebrow);
    // Module and author title: not translated.
    expect(within(list).getByText("Module one")).toBeInTheDocument();
    expect(screen.getByText("Reproduciendo ahora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(head()).getByRole("button", { name: "Next lesson: Lesson three" })).toBeInTheDocument();
    expect(screen.getByText("Playing now")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });
});

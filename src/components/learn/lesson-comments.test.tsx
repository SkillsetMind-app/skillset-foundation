import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { Course } from "@/domain/learning";
import {
  countOpenCommunityQuestions,
  createCommunityPost,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";
import { recordLessonProgress } from "@/lib/data/lesson-progress";

/**
 * P3 of the Hotmart parity work (§4.3 of the 2026-09-06 report): lesson comments
 * UNDER the player, reusing the community feed filtered by lesson:
 *   - only the posts for this lesson, with a count in the title, author, relative time,
 *     number of replies and "View in community" (the post drawer);
 *   - switching lessons swaps the list without reopening the channel (one channel per course);
 *   - community turned off hides the section; preview disables the box;
 *   - posting is the SAME path as the question with a lesson attached (createCommunityPost
 *     with lessonId and "lesson N"); errors stay as keys and get translated;
 *   - EN and ES.
 *
 * Its own file: classroom-home.test.tsx is already heavy. The mocks are the
 * SAME as there — in particular the single `auth` per session (a new object on every
 * render resubscribes the enrollment in a loop) and the subscription fuse.
 */

const HOUR = 3_600_000;

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
  postSubscriptions: 0,
  postsCallback: null as null | ((posts: CommunityPost[]) => void),
  postsError: null as null | ((error: Error) => void),
  postsReload: vi.fn(async () => undefined),
  commentsCallback: null as null | ((comments: CommunityComment[]) => void),
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
    // Fuse: a subscription loop is synchronous inside the render — not even the
    // vitest timeout can reach it. It becomes a failure that ends, not a hang.
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

// The SAME source as the feed: the per-course subscriptions from community-posts.ts. The
// test delivers the posts through the callback, as Supabase would; the fuse
// catches a resubscription loop before the machine hangs.
vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(
    (_slug: string, onNext: (posts: CommunityPost[]) => void, onError: (error: Error) => void) => {
      mocks.postSubscriptions += 1;
      if (mocks.postSubscriptions > 20) {
        throw new Error("subscribeToCommunityPosts called more than 20 times: render loop");
      }
      mocks.postsCallback = onNext;
      mocks.postsError = onError;
      return Object.assign(vi.fn(), { reload: mocks.postsReload });
    },
  ),
  subscribeToCourseCommunityComments: vi.fn(
    (_slug: string, onNext: (comments: CommunityComment[]) => void) => {
      mocks.commentsCallback = onNext;
      return vi.fn();
    },
  ),
  createCommunityPost: vi.fn(() => Promise.resolve({ id: "post-new" })),
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
vi.mock("@/components/shared/protected-asset-preview", () => ({
  ProtectedAssetPreview: () => null,
  ProtectedAssetDownload: () => null,
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "dark",
  communityEnabled: true,
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
  ],
} as unknown as Course;

function post(overrides: Partial<CommunityPost>): CommunityPost {
  return {
    id: "p",
    courseSlug: "course-1",
    authorId: "student-2",
    authorName: "Carla Souza",
    authorRole: "student",
    category: "question",
    body: "",
    // 2 h and a few minutes: "2h ago" even if the test is slow.
    createdAt: new Date(Date.now() - 2 * HOUR - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

// One question on lesson 1, one on lesson 2, one share with no lesson.
const posts: CommunityPost[] = [
  post({ id: "q-l1", title: "Where is the template for step 3?", lessonId: "l1", lessonTitle: "lesson 1" }),
  post({
    id: "q-l2",
    authorId: "student-3",
    authorName: "Lucas Melo",
    title: "Does the checklist apply to remote teams?",
    lessonId: "l2",
    lessonTitle: "lesson 2",
    createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
  }),
  post({
    id: "share",
    category: "discussion",
    body: "The honest-scarcity checklist saved a launch this week.",
    lessonId: null,
  }),
];

const comments: CommunityComment[] = [
  {
    id: "c1", postId: "q-l1", courseSlug: "course-1", authorId: "teacher-1", authorName: "Ana Prof",
    authorRole: "teacher", body: "Module resources, second file.",
    createdAt: new Date(Date.now() - HOUR).toISOString(),
  },
  {
    id: "c2", postId: "q-l1", courseSlug: "course-1", authorId: "student-2", authorName: "Carla Souza",
    authorRole: "student", body: "Found it, thanks!",
    createdAt: new Date(Date.now() - HOUR / 2).toISOString(),
  },
];

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderClassroom(
  search: string,
  props: Partial<Parameters<typeof EnrolledCourseWorkspace>[0]> = {},
) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname = "/learn/courses/demo-course";
  mocks.completed = [];
  return render(<EnrolledCourseWorkspace course={course} {...props} />);
}

function deliverFeed() {
  act(() => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
  });
}

function head() {
  const element = document.querySelector(".member-classroom-head");
  if (!element) throw new Error("short lesson header did not render");
  return element as HTMLElement;
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.enrollmentSubscriptions = 0;
  mocks.postSubscriptions = 0;
  mocks.postsCallback = null;
  mocks.postsError = null;
  mocks.postsReload.mockClear();
  mocks.commentsCallback = null;
  vi.mocked(recordLessonProgress).mockClear();
  vi.mocked(countOpenCommunityQuestions).mockClear();
  vi.mocked(createCommunityPost).mockClear();
  vi.mocked(subscribeToCommunityPosts).mockClear();
  vi.mocked(subscribeToCourseCommunityComments).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

describe("lesson comments: read error", () => {
  // The failure used to be a dead end ("We could not load community posts." and the empty state
  // below it): now "Try again" rereads through the same channel.
  it("the failure offers Try again, without the empty state, and the comments arrive without resubscribing", () => {
    renderClassroom("lesson=l1");
    act(() => mocks.postsError?.(new Error("offline")));

    const region = screen.getByRole("region", { name: "Lesson comments" });
    expect(within(region).getByRole("alert")).toHaveTextContent("We could not load community posts.");
    expect(within(region).queryByText("Loading lesson comments...")).not.toBeInTheDocument();
    expect(within(region).queryByText(/No comments on this lesson yet/i)).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(mocks.postsReload).toHaveBeenCalledTimes(1);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);

    deliverFeed();
    const loaded = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(within(loaded).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(loaded).getByText("Carla Souza")).toBeInTheDocument();
    // The button disappeared: focus stayed on the section, not on the <body>.
    expect(loaded).toHaveFocus();
  });
});

describe("lesson comments under the player", () => {
  it("shows only the posts for this lesson, with count, author, time, replies and the link to the drawer", () => {
    renderClassroom("lesson=l1");

    // While the feed has not arrived: a title without a number and, on the screen, a
    // placeholder line shaped like the comment, not the text. There is only one "loading", the
    // one from the lesson panel (F-02): the notice here stays silent until "posted".
    const loading = screen.getByRole("region", { name: "Lesson comments" });
    expect(within(loading).getByRole("status")).toBeEmptyDOMElement();
    expect(within(loading).queryByText(/Loading/)).toBeNull();
    expect(subscribeToCommunityPosts).toHaveBeenCalledExactlyOnceWith(
      "course-1", expect.any(Function), expect.any(Function),
    );
    expect(subscribeToCourseCommunityComments).toHaveBeenCalledExactlyOnceWith(
      "course-1", expect.any(Function), expect.any(Function),
    );

    deliverFeed();

    const region = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(within(region).getByText("Carla Souza")).toBeInTheDocument();
    expect(within(region).getByText("Where is the template for step 3?")).toBeInTheDocument();
    expect(within(region).getByText(/2h ago/)).toBeInTheDocument();
    expect(within(region).getByText("2 replies")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "View in community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l1?lesson=l1",
    );
    // The question from the other lesson and the share with no lesson stay out.
    expect(within(region).queryByText("Does the checklist apply to remote teams?")).toBeNull();
    expect(within(region).queryByText(/honest-scarcity/)).toBeNull();
    // No inline replies, no likes: that stays in the feed.
    expect(within(region).queryByText("Found it, thanks!")).toBeNull();
    expect(within(region).queryByRole("button", { name: /reply|like|clap|👏/i })).toBeNull();

    // Position: after the lesson title ("Lesson information" is gone). For a text
    // lesson (this one): the body comes before the comments — with no video, what is read
    // is the text.
    const title = document.querySelector(".member-lesson-panel__head h2") as HTMLElement;
    const body = document.getElementById("member-lesson-content") as HTMLElement;
    expect(title.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The Community tab counter does not change: one read, the usual one.
    expect(countOpenCommunityQuestions).toHaveBeenCalledExactlyOnceWith("course-1");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("switching lessons swaps the list without reopening the channel (one channel per course)", () => {
    renderClassroom("lesson=l1");
    deliverFeed();
    expect(screen.getByRole("region", { name: "Lesson comments · 1" })).toBeInTheDocument();

    fireEvent.click(within(head()).getByRole("button", { name: "Next lesson: Lesson two" }));

    const region = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(within(region).getByText("Lucas Melo")).toBeInTheDocument();
    expect(within(region).getByText("Does the checklist apply to remote teams?")).toBeInTheDocument();
    expect(within(region).getByText("0 replies")).toBeInTheDocument();
    expect(within(region).queryByText("Where is the template for step 3?")).toBeNull();
    expect(within(region).getByRole("link", { name: "View in community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l2?lesson=l2",
    );
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(subscribeToCourseCommunityComments).toHaveBeenCalledTimes(1);
    expect(countOpenCommunityQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.enrollmentSubscriptions).toBe(1);
  });

  it("community turned off for the course: the whole section disappears and nothing is subscribed", () => {
    renderClassroom("lesson=l1", { course: { ...course, communityEnabled: false } });

    expect(screen.queryByRole("region", { name: /Lesson comments/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Comment on the lesson." })).toBeNull();
    expect(subscribeToCommunityPosts).not.toHaveBeenCalled();
    expect(subscribeToCourseCommunityComments).not.toHaveBeenCalled();
    // The rest of the lesson stays in place.
    expect(document.getElementById("member-lesson-content")).toBeInTheDocument();
  });

  it("teacher preview: disabled box with the door to the feed, no subscription and no list", () => {
    renderClassroom("lesson=l1", { previewMode: true });

    const region = screen.getByRole("region", { name: "Lesson comments" });
    expect(
      within(region).getByRole("button", { name: "This community is linked to course enrollment." }),
    ).toBeDisabled();
    expect(within(region).queryByRole("textbox")).toBeNull();
    expect(within(region).queryByText("Loading lesson comments...")).toBeNull();
    expect(within(region).queryByRole("link")).toBeNull();
    expect(subscribeToCommunityPosts).not.toHaveBeenCalled();
    expect(subscribeToCourseCommunityComments).not.toHaveBeenCalled();
    expect(createCommunityPost).not.toHaveBeenCalled();
  });

  it("posting uses the same path as the question with the lesson attached", async () => {
    renderClassroom("lesson=l1");
    deliverFeed();
    let resolve!: (value: { id: string }) => void;
    vi.mocked(createCommunityPost).mockReturnValueOnce(
      new Promise<{ id: string }>((done) => { resolve = done; }),
    );

    // At rest the box is a button: no textbox on the lesson.
    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));
    const field = screen.getByRole("textbox", { name: "Your comment on this lesson" });
    expect(field).toHaveAttribute("placeholder", "Comment on the lesson.");

    // Too short: the same rule and the same message as the feed, nothing published.
    fireEvent.change(field, { target: { value: "Short" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(
      screen.getByText("Write your question in one line first — at least a few words."),
    ).toBeInTheDocument();
    expect(createCommunityPost).not.toHaveBeenCalled();

    // First line = the question (feed title); the rest = details.
    fireEvent.change(field, {
      target: { value: "Where is the template for step 3? $$50 $&\nI looked in the module resources." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByRole("button", { name: "Posting..." })).toBeDisabled();
    expect(createCommunityPost).toHaveBeenCalledExactlyOnceWith({
      courseSlug: "course-1",
      category: "question",
      title: "Where is the template for step 3? $$50 $&",
      body: "I looked in the module resources.",
      lessonId: "l1",
      lessonTitle: "lesson 1",
      user: mocks.auth.user,
    });

    await act(async () => resolve({ id: "post-new" }));
    expect(screen.queryByRole("textbox", { name: "Your comment on this lesson" })).toBeNull();
    expect(screen.getByRole("button", { name: "Comment on the lesson." })).toBeInTheDocument();
    // The text box is gone: focus returns to the box at rest, it does not fall
    // to the <body>.
    expect(screen.getByRole("button", { name: "Comment on the lesson." })).toHaveFocus();
    // The screen reader hears the posted comment itself, in a single line.
    const region = screen.getByRole("region", { name: /Lesson comments/ });
    expect(within(region).getByRole("status")).toHaveTextContent("Comment posted.");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  // The whole list used to be aria-live: in a busy conversation, every post that
  // arrived was read aloud.
  it("the list is not a live region: only the one-line notice speaks", () => {
    renderClassroom("lesson=l1");
    deliverFeed();
    const region = screen.getByRole("region", { name: "Lesson comments · 1" });
    expect(region.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(within(region).getByRole("status").textContent).toBe("");
    expect(within(region).getByRole("heading", { level: 3, name: "Lesson comments · 1" })).toBeInTheDocument();
  });

  it("a posting error stays as a key and gets translated; EN <-> ES without changing lesson or resubscribing", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );
    deliverFeed();
    vi.mocked(createCommunityPost).mockRejectedValueOnce(new Error("private internal detail"));

    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));
    const draft = "Is there a Portuguese version? $$ $&";
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment on this lesson" }), {
      target: { value: draft },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Comment" })); });
    expect(screen.getByText("We could not publish your post.")).toBeInTheDocument();
    expect(screen.queryByText("private internal detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("No pudimos publicar tu publicación.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu comentario sobre esta lección" })).toHaveValue(draft);
    const region = screen.getByRole("region", { name: "Comentarios de la lección · 1" });
    expect(within(region).getByRole("button", { name: "Comentar" })).toBeInTheDocument();
    expect(within(region).getByText("2 respuestas")).toBeInTheDocument();
    expect(within(region).getByText(/Hace 2 h/)).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Ver en la comunidad" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community/q/q-l1?lesson=l1",
    );

    fireEvent.click(within(region).getByRole("button", { name: "Cancelar" }));
    expect(within(region).getByRole("button", { name: "Comenta algo sobre la lección." })).toBeInTheDocument();
    expect(within(region).queryByText("No pudimos publicar tu publicación.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("region", { name: "Lesson comments · 1" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(createCommunityPost).toHaveBeenCalledTimes(1);
  });

  // The database refuses with RATE_LIMIT when the person goes over the hourly cap
  // (P2-9): the box asks them to wait, instead of showing the generic error.
  it("the database hourly cap becomes a translated 'wait a little', with the draft kept in place", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <EnrolledCourseWorkspace course={course} />
      </I18nProvider>,
    );
    deliverFeed();
    vi.mocked(createCommunityPost).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });

    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));
    const draft = "Is there a Portuguese version? $$ $&";
    fireEvent.change(screen.getByRole("textbox", { name: "Your comment on this lesson" }), {
      target: { value: draft },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Comment" })); });
    expect(
      screen.getByText("You've posted a lot in the last hour. Wait a little and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("We could not publish your post.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(
      screen.getByText("Publicaste mucho en la última hora. Espera un poco y vuelve a intentarlo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu comentario sobre esta lección" })).toHaveValue(draft);
  });

  it("only one box per lesson (September 7 decision): the old one, from the lesson_comments table, is gone", () => {
    renderClassroom("lesson=l1");
    deliverFeed();

    // At rest: no textbox on the lesson and a single comment button.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /comment/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Comment on the lesson." }));

    // Open: ONE textbox and ONE "Comment" — the ones from the new box, under the player.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /comment/i })).toHaveLength(1);
    // The block at the end of the body (the old box) does not exist.
    expect(document.getElementById("member-lesson-discussion")).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommunityFeed } from "@/components/learn/community-feed";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import { formatEventDateTime } from "@/domain/course-event";
import type { CommunitySpace } from "@/domain/learning";
import type { Enrollment } from "@/domain/enrollment";
import { createCommunityPost, createCommunityComment, createCommunityReport, deleteCommunityComment, deleteCommunityPost, setCommunityPostAcceptedAnswer, setCommunityPostPinned, subscribeToCommunityPosts } from "@/lib/data/community-posts";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { setCommunityPostLike } from "@/lib/data/gamification";

/**
 * Mockup 5, rodada 11 — o feed simplificado, renderizado de verdade:
 *  - tres filtros (All · Questions com abertas · From <instrutor>), busca;
 *  - "Ask a question" expands in place, with the lesson attached and similar
 *    questions already answered;
 *  - light card: instructor, pinned, "from lesson 5", Question -> Answered,
 *    the first answer INSIDE the card (the accepted one in green);
 *  - posts by other people become the "N new posts" pill instead of pushing
 *    the screen; your own go in right away;
 *  - side column: live that becomes "Join", who is online, "Say hi" only in the
 *    first week.
 */

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const HOUR = 3_600_000;

const mocks = vi.hoisted(() => ({
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "ana@example.com", displayName: "Ana Ribeiro", roles: ["student"] },
  },
  postsCallback: null as null | ((posts: CommunityPost[]) => void),
  commentsCallback: null as null | ((comments: CommunityComment[]) => void),
  presenceCallback: null as null | ((members: { uid: string; name: string }[]) => void),
  eventsCallback: null as null | ((events: unknown[]) => void),
  // vi.hoisted runs before the module constants: literal date (NOW - 2 days).
  enrollmentCreatedAt: "2026-08-31T12:00:00.000Z",
  subscriptions: 0,
  pathname: "/learn/courses/course-1/community",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (e: unknown) => void) => {
    mocks.subscriptions += 1;
    if (mocks.subscriptions > 20) {
      throw new Error("subscribeToEnrollment in a loop");
    }
    onNext({
      id: "enr-1",
      userId: "student-1",
      courseId: "course-1",
      courseSlug: "course-1",
      courseTitle: "Leading Teams Through Change",
      status: "active",
      source: "payment",
      progressPercent: 10,
      lastLessonId: null,
      createdAt: mocks.enrollmentCreatedAt,
    });
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/community-posts", () => ({
  subscribeToCommunityPosts: vi.fn((_slug: string, onNext: (posts: CommunityPost[]) => void) => {
    mocks.postsCallback = onNext;
    return vi.fn();
  }),
  subscribeToCourseCommunityComments: vi.fn(
    (_slug: string, onNext: (comments: CommunityComment[]) => void) => {
      mocks.commentsCallback = onNext;
      return vi.fn();
    },
  ),
  createCommunityPost: vi.fn(() => Promise.resolve()),
  createCommunityComment: vi.fn(() => Promise.resolve()),
  setCommunityPostPinned: vi.fn(() => Promise.resolve()),
  setCommunityPostAcceptedAnswer: vi.fn(() => Promise.resolve()),
  deleteCommunityPost: vi.fn(() => Promise.resolve()),
  deleteCommunityComment: vi.fn(() => Promise.resolve()),
  createCommunityReport: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data/community-presence", () => ({
  subscribeToCommunityPresence: vi.fn(
    (_slug: string, _user: unknown, onNext: (members: { uid: string; name: string }[]) => void) => {
      mocks.presenceCallback = onNext;
      return vi.fn();
    },
  ),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn((_slug: string, onNext: (events: unknown[]) => void) => {
    mocks.eventsCallback = onNext;
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/gamification", () => ({
  subscribeToPostLikes: vi.fn((_postId: string, onNext: (s: unknown) => void) => {
    onNext({ count: 0, likerIds: [] });
    return vi.fn();
  }),
  setCommunityPostLike: vi.fn(() => Promise.resolve()),
}));

const space: CommunitySpace = {
  id: "creator-course-1",
  courseSlug: "course-1",
  name: "Leading Teams Through Change community",
  description: "A course-linked space.",
  visibility: "enrolled_only",
  categories: ["announcement", "discussion", "question", "resource"],
};

function post(overrides: Partial<CommunityPost>): CommunityPost {
  return {
    id: "p",
    courseSlug: "course-1",
    authorId: "student-2",
    authorName: "Carla Souza",
    authorRole: "student",
    category: "question",
    body: "",
    createdAt: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

const posts: CommunityPost[] = [
  post({
    id: "pinned",
    authorId: "teacher-1",
    authorName: "Patrick S.",
    authorRole: "teacher",
    category: "announcement",
    body: "This week: persuasion you can defend in front of your team.",
    pinned: true,
    createdAt: new Date(NOW - 5 * 24 * HOUR).toISOString(),
  }),
  post({
    id: "answered",
    title: "How do you set a real deadline for someone who sees every deadline as manipulation?",
    body: "He was burned by fake urgency at his last job.",
    lessonId: "l5",
    lessonTitle: "lesson 5",
    acceptedCommentId: "c-answer",
    createdAt: new Date(NOW - 3 * HOUR).toISOString(),
  }),
  post({
    id: "open",
    authorId: "student-3",
    authorName: "Lucas Melo",
    title: "Is there a Portuguese version of the bias checklist?",
    body: "My team reads Portuguese better than English.",
    createdAt: new Date(NOW - 24 * HOUR).toISOString(),
  }),
  post({
    id: "share",
    authorId: "student-4",
    authorName: "Marcos Lima",
    category: "discussion",
    body: "The honest-scarcity checklist saved a launch this week.",
    createdAt: new Date(NOW - 26 * HOUR).toISOString(),
  }),
];

const comments: CommunityComment[] = [
  {
    id: "c-first",
    postId: "answered",
    courseSlug: "course-1",
    authorId: "student-4",
    authorName: "Marcos Lima",
    authorRole: "student",
    body: "Following, same problem here.",
    createdAt: new Date(NOW - 2.5 * HOUR).toISOString(),
  },
  {
    id: "c-answer",
    postId: "answered",
    courseSlug: "course-1",
    authorId: "teacher-1",
    authorName: "Patrick S.",
    authorRole: "teacher",
    body: "Show the constraint, not the pressure.",
    createdAt: new Date(NOW - 2 * HOUR).toISOString(),
  },
  {
    id: "c-third",
    postId: "answered",
    courseSlug: "course-1",
    authorId: "student-2",
    authorName: "Carla Souza",
    authorRole: "student",
    body: "That reframes it completely.",
    createdAt: new Date(NOW - HOUR).toISOString(),
  },
];

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

const enrollmentFixture: Enrollment = {
  id: "enr-1", userId: "student-1", courseId: "course-1", courseSlug: "course-1",
  courseTitle: "Leading Teams Through Change", courseCategory: "", courseImage: "",
  status: "active", source: "payment", progressPercent: 10, lastLessonId: null,
};

async function renderFeed(props: Partial<Parameters<typeof CommunityFeed>[0]> = {}, locale?: "en" | "es") {
  const feed = <CommunityFeed space={space} instructorName="Patrick" {...props} />;
  const view = render(locale ? <I18nProvider initialLocale={locale}><ChangeLanguage />{feed}</I18nProvider> : feed);
  await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
  await act(async () => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
    mocks.eventsCallback?.([]);
    mocks.presenceCallback?.([]);
  });
  return view;
}

describe("community feed (round 11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mocks.postsCallback = null;
    mocks.commentsCallback = null;
    mocks.presenceCallback = null;
    mocks.eventsCallback = null;
    mocks.subscriptions = 0;
    mocks.enrollmentCreatedAt = new Date(NOW - 2 * 24 * HOUR).toISOString();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // F-03: the wait has the shape of the posts, with the sentence only for the screen reader.
  // C-04: the filter in the segmented selector design (light pill, not solid navy).
  it("loading state shaped like the posts, and filter in the segmented design", async () => {
    render(<I18nProvider initialLocale="en"><CommunityFeed space={space} instructorName="Patrick" /></I18nProvider>);
    await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
    const waiting = screen.getByText("Loading community feed...");
    expect(waiting).toHaveClass("sr-only");
    expect(waiting.closest("[role='status']")).not.toBeNull();

    await act(async () => mocks.postsCallback?.(posts));
    expect(screen.queryByText("Loading community feed...")).toBeNull();
    const group = screen.getByRole("group", { name: "Filter posts" });
    expect(group).toHaveClass("rounded-lg", "border", "bg-[var(--color-surface-soft)]", "p-1");
    const all = within(group).getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveClass("bg-white", "text-[var(--color-primary)]", "shadow-[var(--shadow-soft)]");
    expect(all.className).not.toContain("bg-[var(--color-primary)]");
    expect(within(group).getByRole("button", { name: "Questions · 1 open" })).toHaveClass("border-transparent");
  });

  it("translates filters and a literal instructor name while preserving query, focus and subscriptions", async () => {
    await renderFeed({ instructorName: "Pat $$50 $&" }, "en");
    fireEvent.click(screen.getByRole("button", { name: "Questions · 1 open" }));
    const search = screen.getByRole("searchbox", { name: "Search posts" });
    fireEvent.change(search, { target: { value: "portuguese" } });
    search.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Preguntas · 1 abierta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "De Pat $$50 $&" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar publicaciones" })).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("portuguese");
    expect(screen.getByRole("article")).toHaveTextContent("My team reads Portuguese better than English.");
    expect(screen.getByRole("heading", { name: "Leading Teams Through Change" })).toBeInTheDocument();
    expect(mocks.subscriptions).toBe(1);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(createCommunityPost).not.toHaveBeenCalled();
    expect(setCommunityPostLike).not.toHaveBeenCalled();
    expect(setCommunityPostPinned).not.toHaveBeenCalled();
  });

  it("keeps the question draft, focus, lesson attachment and original payload during a locale change and pending post", async () => {
    await renderFeed({ currentLesson: { id: "l3", title: "Original lesson", number: 3 } }, "en");
    let resolve!: (value: Awaited<ReturnType<typeof createCommunityPost>>) => void;
    vi.mocked(createCommunityPost).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    const question = screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(question, { target: { value: "Question literal $$50 $&" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Details (optional)" }), { target: { value: "Details $$ $&" } });
    question.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Tu pregunta" })).toBe(question);
    expect(question).toHaveFocus();
    expect(question).toHaveValue("Question literal $$50 $&");
    expect(screen.getByText("Sobre la lección 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publicar pregunta" }));
    expect(screen.getByRole("button", { name: "Publicando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Posting..." })).toBeDisabled();
    expect(question).toHaveValue("Question literal $$50 $&");
    expect(createCommunityPost).toHaveBeenCalledExactlyOnceWith({
      courseSlug: space.courseSlug, category: "question", title: "Question literal $$50 $&", body: "Details $$ $&",
      lessonId: "l3", lessonTitle: "lesson 3", user: mocks.auth.user,
    });
    await act(async () => resolve({ id: "post-test" }));
    expect(screen.queryByRole("form", { name: "Ask a question" })).not.toBeInTheDocument();
    expect(createCommunityPost).toHaveBeenCalledTimes(1);
  });

  it("keeps a removed attachment removed when relocalizing the composer", async () => {
    await renderFeed({ currentLesson: { id: "l3", title: "Original lesson", number: 3 } }, "en");
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove lesson 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.queryByText("Sobre la lección 3")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Tu pregunta" }), { target: { value: "Question $$ $& literal" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Publicar pregunta" })); });
    expect(createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ lessonId: null, lessonTitle: null }));
  });

  it.each([
    // No "Share" button: the fake field opens the same form.
    ["Ask the cohort or share something...", "Compartir", "Tu publicación", "Publicar", "discussion"],
    ["Post an update", "Publicar un aviso", "Tu publicación", "Publicar aviso", "announcement"],
  ])("preserves the %s draft and payload while translating", async (entry, formName, label, submit, category) => {
    await renderFeed({ canModerate: true }, "en");
    fireEvent.click(screen.getByRole("button", { name: entry }));
    const field = screen.getByRole("textbox", { name: "Your post" });
    fireEvent.change(field, { target: { value: "Original content $$50 $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("form", { name: formName })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: label })).toBe(field);
    expect(field).toHaveValue("Original content $$50 $&");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: submit })); });
    expect(createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ category, body: "Original content $$50 $&", title: null, lessonId: null, lessonTitle: null }));
  });

  // The list is no longer aria-live, the post itself goes straight into it and the
  // form closes: without this, screen reader users heard nothing and
  // focus fell to the page body.
  it("after posting: 'Posted.' in the status region and focus returns to the composer field", async () => {
    await renderFeed({}, "en");
    fireEvent.click(screen.getByRole("button", { name: "Ask the cohort or share something..." }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your post" }), { target: { value: "Sharing my worksheet notes." } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Post" })); });

    expect(createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ category: "discussion", body: "Sharing my worksheet notes." }));
    expect(screen.getByRole("button", { name: "Ask the cohort or share something..." })).toHaveFocus();
    expect(screen.getAllByRole("status").some((node) => node.textContent === "Posted.")).toBe(true);
  });

  it("translates a stored validation error and retains the draft without publishing", async () => {
    await renderFeed({}, "en");
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Post question" }));
    expect(screen.getByText("Write your question in one line first — at least a few words.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Escribe primero tu pregunta en una línea, con al menos unas palabras.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu pregunta" })).toHaveValue("short");
    expect(createCommunityPost).not.toHaveBeenCalled();
  });

  it("does not reveal pending posts just because the locale changes", async () => {
    await renderFeed({}, "en");
    act(() => mocks.postsCallback?.([post({ id: "arrival", body: "New literal $$ $&", category: "discussion" }), ...posts]));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "1 publicación nueva" })).toBeInTheDocument();
    expect(screen.queryByText("New literal $$ $&")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "1 publicación nueva" }));
    expect(screen.getByText("New literal $$ $&")).toBeInTheDocument();
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
  });

  it("shows the localized access-load failure without opening the community gate", () => {
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, _next, onError) => {
      onError(new Error("private cause"));
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    render(<I18nProvider initialLocale="es"><CommunityFeed space={space} /></I18nProvider>);
    expect(screen.getByText("No pudimos confirmar tu acceso a la comunidad.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esta comunidad está vinculada a la inscripción en el curso." })).toBeInTheDocument();
    expect(subscribeToCommunityPosts).not.toHaveBeenCalled();
    expect(createCommunityPost).not.toHaveBeenCalled();
  });

  // Read failures were dead ends: "Try again" re-reads through the same channel, without
  // re-subscribing, and the notice only goes away when the read comes back.
  it("an access failure offers Try again; when the enrollment arrives the feed opens with focus on the title", async () => {
    let deliver: (enrollment: Enrollment | null) => void = () => {};
    const reload = vi.fn(async () => deliver(enrollmentFixture));
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, next, onError) => {
      deliver = next;
      onError(new Error("private cause"));
      return Object.assign(vi.fn(), { reload });
    });
    render(<I18nProvider initialLocale="en"><CommunityFeed space={space} /></I18nProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("We could not confirm your community access.");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toHaveAttribute("data-community-heading");
  });

  it("an access Try again that fails again disarms the focus: the enrollment that arrives later does not pull it", async () => {
    let deliver: (enrollment: Enrollment | null) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const reload = vi.fn(async () => fail(new Error("still down")));
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, next, onError) => {
      deliver = next;
      fail = onError;
      onError(new Error("private cause"));
      return Object.assign(vi.fn(), { reload });
    });
    render(<I18nProvider initialLocale="en"><CommunityFeed space={space} /></I18nProvider>);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("We could not confirm your community access.");

    act(() => deliver(enrollmentFixture));
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toHaveAttribute("data-community-heading");
  });

  it("a posts failure offers Try again without the empty state, and the posts go straight in when they arrive", async () => {
    let onError: (error: Error) => void = () => {};
    const reload = vi.fn(async () => undefined);
    vi.mocked(subscribeToCommunityPosts).mockImplementationOnce((_slug, next, fail) => {
      mocks.postsCallback = next;
      onError = fail;
      return Object.assign(vi.fn(), { reload });
    });
    render(<I18nProvider initialLocale="en"><CommunityFeed space={space} instructorName="Patrick" /></I18nProvider>);
    await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
    act(() => onError(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load community posts.");
    expect(screen.queryByText("Loading community feed...")).not.toBeInTheDocument();
    expect(screen.queryByText(/No posts yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);

    await act(async () => mocks.postsCallback?.(posts));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The first good read goes into the list, not into the "N new posts" pill.
    expect(screen.getAllByRole("article")).toHaveLength(posts.length);
    expect(screen.queryByRole("button", { name: /new post/ })).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("data-community-heading");

    // A channel re-read that fails afterwards does not remove the posts from the screen.
    act(() => onError(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load community posts.");
    expect(screen.getAllByRole("article")).toHaveLength(posts.length);
  });

  it("keeps an inline reply and its focused field until the pending response settles across locales", async () => {
    await renderFeed({}, "en");
    const card = screen.getByRole("article", { name: /Portuguese version/ });
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    const field = within(card).getByRole("textbox", { name: "Your reply" });
    fireEvent.change(field, { target: { value: "Reply literal $$50 $&" } });
    field.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(card).getByRole("textbox", { name: "Tu respuesta" })).toBe(field);
    expect(field).toHaveFocus();
    let resolve!: (value: { id: string }) => void;
    vi.mocked(createCommunityComment).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(within(card).getByRole("button", { name: "Publicar respuesta" }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(card).getByRole("button", { name: "Posting..." })).toBeDisabled();
    expect(field).toHaveValue("Reply literal $$50 $&");
    expect(createCommunityComment).toHaveBeenCalledExactlyOnceWith({ postId: "open", courseSlug: space.courseSlug, body: "Reply literal $$50 $&", user: mocks.auth.user });
    await act(async () => resolve({ id: "reply-test" }));
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
  });

  // The database refuses with RATE_LIMIT when the person goes over the hourly cap
  // (P2-9): the screen asks them to wait, instead of telling them to try again right away.
  it("asks the member to wait when the database refuses a post over the hourly cap, keeping the draft", async () => {
    await renderFeed({}, "en");
    vi.mocked(createCommunityPost).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), { target: { value: "Question literal $$50 $&" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Post question" })); });
    expect(screen.getByText("You've posted a lot in the last hour. Wait a little and try again.")).toBeInTheDocument();
    expect(screen.queryByText("We could not publish your post.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Publicaste mucho en la última hora. Espera un poco y vuelve a intentarlo.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tu pregunta" })).toHaveValue("Question literal $$50 $&");
    expect(screen.queryByText("RATE_LIMIT")).toBeNull();
  });

  it("asks the member to wait when the database refuses an inline reply over the hourly cap", async () => {
    await renderFeed({}, "en");
    vi.mocked(createCommunityComment).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    const card = screen.getByRole("article", { name: /Portuguese version/ });
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Your reply" }), { target: { value: "Reply literal $$50 $&" } });
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Post reply" })); });
    expect(within(card).getByText("You've posted a lot in the last hour. Wait a little and try again.")).toBeInTheDocument();
    expect(within(card).queryByText("We could not publish your reply.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(card).getByText("Publicaste mucho en la última hora. Espera un poco y vuelve a intentarlo.")).toBeInTheDocument();
    expect(within(card).getByRole("textbox", { name: "Tu respuesta" })).toHaveValue("Reply literal $$50 $&");
  });

  it("localizes the live state, member panel and rules without changing the scheduled session", async () => {
    await renderFeed({ instructorName: "Pat $$ $&" }, "en");
    act(() => {
      mocks.eventsCallback?.([{ id: "event-test", title: "Original live $$ $&", startsAt: new Date(NOW + 40 * 60_000).toISOString(), externalUrl: "https://example.com/live-test" }]);
      mocks.presenceCallback?.([{ uid: "teacher-1", name: "Pat $$ $&" }]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("region", { name: "Próxima sesión en vivo" })).toHaveTextContent("En vivo en 40 min");
    expect(screen.getByText("Pregunta sobre el curso y comparte lo que has probado.")).toBeInTheDocument();
    expect(screen.getByText("Pat $$ $& responde a cada presentación.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reglas" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Grabaciones" })).toHaveAttribute("href", "/learn/courses/course-1/lives");
    await act(async () => { vi.setSystemTime(NOW + 41 * 60_000); await vi.advanceTimersByTimeAsync(30_000); });
    expect(within(screen.getByRole("region", { name: "Próxima sesión en vivo" })).getByRole("link", { name: "Unirse" })).toHaveAttribute("href", "https://example.com/live-test");
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
  });

  it("three filters: All with the pinned one on top; Questions counts the open ones; the From filter shows only the instructor", async () => {
    await renderFeed();

    const cards = screen.getAllByRole("article");
    expect(cards[0]).toHaveTextContent("Patrick S.");
    expect(cards[0]).toHaveTextContent("Instructor");
    expect(cards[0]).toHaveTextContent("pinned");
    expect(cards).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Questions · 1 open" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "From Patrick" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("This week: persuasion");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search posts" }), {
      target: { value: "portuguese" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("Portuguese version");
  });

  it("card: Answered with the accepted reply INSIDE (in green), 'from lesson 5', 'View 3 replies'; the open one says Question", async () => {
    await renderFeed();

    const answered = screen.getByRole("article", { name: /real deadline/ });
    expect(answered).toHaveTextContent("Answered");
    expect(answered).toHaveTextContent("from lesson 5");
    expect(within(answered).getByText("Show the constraint, not the pressure.")).toBeInTheDocument();
    expect(within(answered).queryByText("Following, same problem here.")).toBeNull();
    expect(within(answered).getByText("answer")).toBeInTheDocument();
    // "View 3 replies" opens the drawer (11b) — it does not expand in the card.
    expect(within(answered).getByRole("button", { name: "View 3 replies" })).toBeInTheDocument();

    const open = screen.getByRole("article", { name: /Portuguese version/ });
    expect(open).toHaveTextContent("Question");
    expect(open).not.toHaveTextContent("Answered");
  });

  it("Ask a question: expands in place, with the lesson attached (removable) and similar questions already answered", async () => {
    await renderFeed({ currentLesson: { id: "l3", title: "Bias checklist", number: 3 } });

    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    const form = screen.getByRole("form", { name: "Ask a question" });
    expect(within(form).getByText("About lesson 3")).toBeInTheDocument();

    fireEvent.change(within(form).getByPlaceholderText("What do you want to ask?"), {
      target: { value: "How do I set a real deadline for someone on my team?" },
    });
    expect(within(form).getByText("Already answered · similar")).toBeInTheDocument();
    expect(within(form).getByText(/real deadline for someone who sees/)).toBeInTheDocument();

    fireEvent.click(within(form).getByRole("button", { name: "Post question" }));
    await waitFor(() =>
      expect(createCommunityPost).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "question",
          title: "How do I set a real deadline for someone on my team?",
          lessonId: "l3",
          lessonTitle: "lesson 3",
        }),
      ),
    );
  });

  it("removing the attached lesson sends the question without a lesson", async () => {
    await renderFeed({ currentLesson: { id: "l3", title: "Bias checklist", number: 3 } });

    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove lesson 3" }));
    expect(screen.queryByText("About lesson 3")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("What do you want to ask?"), {
      target: { value: "Can I skip the reading and come back later?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post question" }));
    await waitFor(() =>
      expect(createCommunityPost).toHaveBeenCalledWith(
        expect.objectContaining({ lessonId: null, lessonTitle: null }),
      ),
    );
  });

  it("a new post from SOMEONE ELSE becomes the '1 new post' pill; mine shows up right away", async () => {
    await renderFeed();
    expect(screen.getAllByRole("article")).toHaveLength(4);

    const fromOther = post({ id: "new-other", authorId: "student-9", authorName: "Pedro Alves", category: "discussion", body: "Anyone tried the worksheet?", createdAt: new Date(NOW).toISOString() });
    await act(async () => {
      mocks.postsCallback?.([fromOther, ...posts]);
    });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.queryByText("Anyone tried the worksheet?")).toBeNull();
    // Only the "1 new post" line is announced; the list is no longer a live region.
    const feedStatus = screen.getAllByRole("status").find((node) => node.textContent === "1 new post");
    expect(feedStatus).toBeDefined();
    expect(screen.getAllByRole("article")[0].closest("[aria-live]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 new post" }));
    expect(feedStatus?.textContent).toBe("");
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByText("Anyone tried the worksheet?")).toBeInTheDocument();

    const mine = post({ id: "mine", authorId: "student-1", authorName: "Ana Ribeiro", category: "discussion", body: "My own share.", createdAt: new Date(NOW).toISOString() });
    await act(async () => {
      mocks.postsCallback?.([mine, fromOther, ...posts]);
    });
    expect(screen.getByText("My own share.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new post/ })).toBeNull();
  });

  // The "Like" on your own post is locked; before, nothing said why.
  it("the locked Like on your own post says why; on others' posts it does not", async () => {
    await renderFeed();
    const mine = post({ id: "mine", authorId: "student-1", authorName: "Ana Ribeiro", category: "discussion", body: "My own share." });
    await act(async () => {
      mocks.postsCallback?.([mine, ...posts]);
    });

    const own = within(screen.getByText("My own share.").closest("article")!).getByRole("button", { name: /^Like · \d+$/ });
    expect(own).toBeDisabled();
    expect(own).toHaveAccessibleDescription("You can't like your own post.");
    // The reason is also in plain sight, not only for the screen reader.
    expect(screen.getByText("You can't like your own post.")).not.toHaveClass("sr-only");
    const other = within(screen.getAllByRole("article").find((card) => !card.textContent?.includes("My own share."))!).getByRole("button", { name: /^Like · \d+$/ });
    expect(other).not.toHaveAttribute("aria-describedby");
  });

  // The empty list is the platform's EmptyState, with h3 like the posts.
  it("with no posts, the empty state is the EmptyState with an h3 title", async () => {
    render(<CommunityFeed space={space} instructorName="Patrick" />);
    await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
    await act(async () => {
      mocks.postsCallback?.([]);
      mocks.commentsCallback?.([]);
      mocks.eventsCallback?.([]);
      mocks.presenceCallback?.([]);
    });

    const heading = screen.getByRole("heading", { level: 3, name: "No posts yet. Ask the first question or share what you're working on." });
    expect(heading.closest("div.border-dashed")).not.toBeNull();
  });

  // Before: eyebrow "COMMUNITY" + 24px h2 with the course name (repeating the
  // h1 and the tab), "Share" doing the same as the field, and an empty card
  // "No live scheduled yet." always on the side.
  it("lean chrome: title only for the screen reader, one entry per task, no empty live card", async () => {
    await renderFeed({ canModerate: true });

    // Hidden, but it shows up when it receives focus (after deleting the last post).
    expect(screen.getByRole("heading", { level: 2, name: "Leading Teams Through Change" })).toHaveClass("sr-only", "focus:not-sr-only");
    expect(screen.queryByText("Community")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask the cohort or share something..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post an update" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Next live" })).toBeNull();
    expect(screen.queryByText("No live scheduled yet.")).toBeNull();
    // Reaction with an icon (not an emoji) and an instructor post without the colored border.
    expect(document.body.textContent).not.toContain("👏");
    expect(screen.getAllByRole("button", { name: /^Like · \d+$/ }).length).toBeGreaterThan(0);
    for (const card of screen.getAllByRole("article")) expect(card.className).not.toContain("border-l-4");
  });

  it("sidebar: 'Live in 40 min' becomes 'Join' when it starts; who is online; 'Say hi' only in the first week", async () => {
    await renderFeed();

    await act(async () => {
      mocks.eventsCallback?.([
        {
          id: "ev-1",
          courseId: "course-1",
          courseSlug: "course-1",
          courseTitle: "Leading Teams",
          ownerId: "teacher-1",
          title: "Live Q&A · module 2",
          description: "",
          type: "live",
          status: "scheduled",
          startsAt: new Date(NOW + 40 * 60_000).toISOString(),
          externalUrl: "https://zoom.us/j/1",
          recordingAssetId: null,
        },
      ]);
      mocks.presenceCallback?.([
        { uid: "teacher-1", name: "Patrick S." },
        { uid: "student-4", name: "Marcos Lima" },
      ]);
    });

    const live = screen.getByRole("region", { name: "Next live" });
    expect(live).toHaveTextContent("Live in 40 min");
    expect(live).toHaveTextContent("The join link appears 15 minutes before the start.");
    expect(within(live).queryByRole("link", { name: "Join" })).toBeNull();
    expect(screen.getByText(/2 online/)).toBeInTheDocument();
    expect(screen.getByText("New here? Say hi 👋")).toBeInTheDocument();

    // 10 min before it is already "starting": the join link shows up, as on the
    // other screens (before, only after the start). Date and time zone in the common sentence.
    await act(async () => {
      vi.setSystemTime(NOW + 30 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const soon = screen.getByRole("region", { name: "Next live" });
    expect(within(soon).getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://zoom.us/j/1");
    expect(soon).toHaveTextContent(formatEventDateTime(new Date(NOW + 40 * 60_000).toISOString(), "en"));

    await act(async () => {
      vi.setSystemTime(NOW + 41 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(within(screen.getByRole("region", { name: "Next live" })).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "https://zoom.us/j/1",
    );
  });

  // Webinar at 6:00 and office hours at 7:30 (90 min later): the card shows the one
  // whose start is nearest to now. The oldest stayed "live" for 3 h and
  // hid the next one. A deadline is not live: it stays out of the card.
  it.each([
    ["7:20", 80, "Office hours", "Live in 10 min"],
    ["6:10", 10, "Webinar", "Live now"],
  ])("two sessions 90 min apart, at %s: the card shows the one closest to now", async (_label, offset, title, chip) => {
    await renderFeed();
    const session = (id: string, name: string, minutes: number, type = "live_class") => ({
      id, title: name, type, status: "scheduled", startsAt: new Date(NOW + minutes * 60_000).toISOString(),
      externalUrl: `https://zoom.us/j/${id}`,
    });
    await act(async () => {
      mocks.eventsCallback?.([
        session("webinar", "Webinar", 0),
        session("office", "Office hours", 90),
        session("due", "Essay due", offset + 5, "deadline"),
      ]);
      vi.setSystemTime(NOW + offset * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const live = screen.getByRole("region", { name: "Next live" });
    expect(live).toHaveTextContent(title);
    expect(live).toHaveTextContent(chip);
    expect(live).not.toHaveTextContent("Essay due");
    expect(within(live).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      title === "Webinar" ? "https://zoom.us/j/webinar" : "https://zoom.us/j/office",
    );
  });

  it("anyone who has been here for more than a week does not see 'Say hi'", async () => {
    mocks.enrollmentCreatedAt = new Date(NOW - 30 * 24 * HOUR).toISOString();
    await renderFeed();

    expect(screen.queryByText("New here? Say hi 👋")).toBeNull();
  });

  it.each(["javascript:void(0)", "data:text/plain,not-a-session", "ftp://example.com/live", "not a URL", ""])(
    "keeps the live details without a join link for invalid URL %j",
    async (externalUrl) => {
      await renderFeed({}, "en");
      act(() => mocks.eventsCallback?.([{
        id: "live-link", title: "Live Q&A", startsAt: new Date(NOW - 60_000).toISOString(), externalUrl,
      }]));
      const live = screen.getByRole("region", { name: "Next live" });
      expect(live).toHaveTextContent("Live Q&A");
      expect(within(live).queryByRole("link")).not.toBeInTheDocument();
      expect(live).toHaveTextContent("The join link has not been added yet. Contact your instructor.");
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(live).toHaveTextContent("Todavía no se agregó el enlace para entrar. Contacta a tu instructor.");
    },
  );

  it("the course owner unpins and deletes a learner's post, which disappears without waiting for realtime", async () => {
    await renderFeed({ canModerate: true });

    const [pinned] = screen.getAllByRole("article");
    fireEvent.click(within(pinned).getByRole("button", { name: "Unpin" }));
    expect(setCommunityPostPinned).toHaveBeenCalledExactlyOnceWith("pinned", false);

    const open = screen.getByRole("article", { name: /Portuguese version/ });
    fireEvent.click(within(open).getByRole("button", { name: "Delete" }));
    await act(async () => { fireEvent.click(within(open).getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityPost).toHaveBeenCalledExactlyOnceWith("open");
    expect(screen.queryByRole("article", { name: /Portuguese version/ })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(subscribeToCommunityPosts).toHaveBeenCalledTimes(1);
  });

  it("a member reports someone else's post; does not see Delete or Unpin", async () => {
    await renderFeed();

    const open = screen.getByRole("article", { name: /Portuguese version/ });
    expect(within(open).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(screen.getAllByRole("article")[0]).queryByRole("button", { name: "Unpin" })).toBeNull();
    fireEvent.click(within(open).getByRole("button", { name: "Report" }));
    await act(async () => { fireEvent.click(within(open).getByRole("button", { name: "Send report" })); });

    expect(createCommunityReport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      courseSlug: "course-1",
      postId: "open",
      commentId: null,
      targetType: "post",
      targetAuthorId: "student-3",
    }));
    expect(within(open).getByRole("status")).toHaveTextContent("Thanks. Our team will review it.");
  });

  it("preserves a valid HTTP live link and trims surrounding whitespace", async () => {
    await renderFeed();
    act(() => mocks.eventsCallback?.([{
      id: "live-link", title: "Live Q&A", startsAt: new Date(NOW - 60_000).toISOString(),
      externalUrl: "  http://example.com/live  ",
    }]));
    const join = within(screen.getByRole("region", { name: "Next live" })).getByRole("link", { name: "Join" });
    expect(join).toHaveAttribute("href", "http://example.com/live");
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noopener noreferrer");
  });
});

/**
 * 11b — the question drawer: opens over the feed with its own URL
 * (.../community/q/<post>), the accepted answer in green at the top, Esc and
 * the X ("Close") close it (going back to the tab's address), and whoever can marks
 * "Mark as the answer".
 */
describe("question drawer (11b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mocks.postsCallback = null;
    mocks.commentsCallback = null;
    mocks.presenceCallback = null;
    mocks.eventsCallback = null;
    mocks.subscriptions = 0;
    mocks.pathname = "/learn/courses/course-1/community";
    mocks.push.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("preserves the open drawer, reply draft and focus while localizing controls and retaining read-only gates", async () => {
    mocks.pathname = "/learn/courses/course-1/community/q/answered";
    await renderFeed({ openPostId: "answered" }, "en");
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    const field = within(drawer).getByRole("textbox", { name: "Add your reply" });
    fireEvent.change(field, { target: { value: "Drawer reply $$50 $&" } });
    field.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("dialog", { name: /real deadline/ })).toBe(drawer);
    expect(within(drawer).getByRole("textbox", { name: "Añade tu respuesta" })).toBe(field);
    expect(field).toHaveValue("Drawer reply $$50 $&");
    expect(field).toHaveFocus();
    expect(within(drawer).getByRole("list", { name: "Respuestas" })).toBeInTheDocument();
    expect(within(drawer).getByText(/de lesson 5/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /como respuesta/ })).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(createCommunityComment).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/learn/courses/course-1/community");
  });

  it("keeps the drawer reply pending across locales and clears it only after the original response", async () => {
    await renderFeed({ openPostId: "answered" }, "en");
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    const field = within(drawer).getByRole("textbox", { name: "Add your reply" });
    fireEvent.change(field, { target: { value: "Draft $$ $&" } });
    let resolve!: (value: { id: string }) => void;
    vi.mocked(createCommunityComment).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Reply" }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    // Sending says what it does, in a word, and follows the language.
    expect(within(drawer).getByRole("button", { name: "Enviando..." })).toBeDisabled();
    expect(field).toHaveValue("Draft $$ $&");
    expect(createCommunityComment).toHaveBeenCalledExactlyOnceWith({ postId: "answered", courseSlug: space.courseSlug, body: "Draft $$ $&", user: mocks.auth.user });
    await act(async () => resolve({ id: "drawer-reply" }));
    expect(field).toHaveValue("");
    expect(within(drawer).getByRole("button", { name: "Responder" })).toBeEnabled();
  });

  it("relocalizes an answer-mark failure without repeating the moderation action", async () => {
    await renderFeed({ openPostId: "answered", canModerate: true }, "en");
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    vi.mocked(setCommunityPostAcceptedAnswer).mockRejectedValueOnce(new Error("private internal detail"));
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Unmark as the answer" })); });
    expect(within(drawer).getByRole("alert")).toHaveTextContent("We could not save the answer mark. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(drawer).getByRole("alert")).toHaveTextContent("No pudimos guardar la respuesta marcada. Inténtalo de nuevo.");
    expect(within(drawer).getByRole("button", { name: "Quitar marca de respuesta" })).toBeInTheDocument();
    expect(setCommunityPostAcceptedAnswer).toHaveBeenCalledExactlyOnceWith("answered", null);
  });

  it("asks the member to wait when the database refuses a drawer reply over the hourly cap", async () => {
    await renderFeed({ openPostId: "answered" }, "en");
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    vi.mocked(createCommunityComment).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "Add your reply" }), { target: { value: "Draft $$ $&" } });
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Reply" })); });
    expect(within(drawer).getByRole("alert")).toHaveTextContent("You've posted a lot in the last hour. Wait a little and try again.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(within(drawer).getByRole("alert")).toHaveTextContent("Publicaste mucho en la última hora. Espera un poco y vuelve a intentarlo.");
    expect(within(drawer).getByRole("textbox", { name: "Añade tu respuesta" })).toHaveValue("Draft $$ $&");
  });

  it("the title and 'View N replies' open the drawer via the address, without changing page", async () => {
    await renderFeed();

    fireEvent.click(screen.getByRole("button", { name: "View 3 replies" }));
    expect(mocks.push).toHaveBeenCalledWith("/learn/courses/course-1/community/q/answered");

    fireEvent.click(screen.getByRole("button", { name: /Portuguese version/ }));
    expect(mocks.push).toHaveBeenCalledWith("/learn/courses/course-1/community/q/open");
  });

  it("with ?q in the address: drawer open, accepted reply first; Esc returns to the tab", async () => {
    mocks.pathname = "/learn/courses/course-1/community/q/answered";
    await renderFeed({ openPostId: "answered" });

    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    // Focus goes into the drawer (tabIndex -1), it does not stay on the feed behind it.
    expect(drawer).toHaveFocus();
    const replies = within(drawer).getAllByRole("listitem");
    expect(replies[0]).toHaveTextContent("Show the constraint, not the pressure.");
    expect(replies[0]).toHaveTextContent("answer");
    expect(replies[1]).toHaveTextContent("Following, same problem here.");
    expect(replies).toHaveLength(3);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(mocks.push).toHaveBeenCalledWith("/learn/courses/course-1/community");

    // Only one close: the X. The duplicate "Back to feed" is gone from the header.
    expect(within(drawer).queryByRole("button", { name: "Back to feed" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/learn/courses/course-1/community");
  });

  it("in the drawer the owner deletes the accepted reply (it disappears) and then the post (the drawer closes)", async () => {
    mocks.pathname = "/learn/courses/course-1/community/q/answered";
    await renderFeed({ openPostId: "answered", canModerate: true });
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });

    const [answer] = within(drawer).getAllByRole("listitem");
    fireEvent.click(within(answer).getByRole("button", { name: "Delete" }));
    expect(within(answer).getByRole("group", { name: /Delete this reply for everyone/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(answer).getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityComment).toHaveBeenCalledExactlyOnceWith("c-answer");
    expect(within(drawer).getAllByRole("listitem")).toHaveLength(2);
    expect(within(drawer).queryByText("Show the constraint, not the pressure.")).toBeNull();

    // The first "Delete" in the drawer is the post's (right below the author).
    fireEvent.click(within(drawer).getAllByRole("button", { name: "Delete" })[0]);
    expect(within(drawer).getByRole("group", { name: /Delete this post for everyone/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityPost).toHaveBeenCalledExactlyOnceWith("answered");
    expect(mocks.push).toHaveBeenLastCalledWith("/learn/courses/course-1/community");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("article", { name: /real deadline/ })).toBeNull();
  });

  it("anyone who is NOT the author or a moderator cannot mark a reply; a moderator unmarks and marks", async () => {
    mocks.pathname = "/learn/courses/course-1/community/q/answered";
    const { unmount } = await renderFeed({ openPostId: "answered" });
    expect(screen.queryByRole("button", { name: /as the answer/ })).toBeNull();
    unmount();

    await renderFeed({ openPostId: "answered", canModerate: true });
    const drawer = screen.getByRole("dialog", { name: /real deadline/ });
    fireEvent.click(within(drawer).getByRole("button", { name: "Unmark as the answer" }));
    const { setCommunityPostAcceptedAnswer } = await import("@/lib/data/community-posts");
    await waitFor(() => expect(setCommunityPostAcceptedAnswer).toHaveBeenCalledWith("answered", null));

    const marks = within(drawer).getAllByRole("button", { name: "Mark as the answer" });
    fireEvent.click(marks[0]);
    await waitFor(() => expect(setCommunityPostAcceptedAnswer).toHaveBeenCalledWith("answered", "c-first"));
  });
});

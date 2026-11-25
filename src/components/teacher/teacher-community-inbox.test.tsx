import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import {
  TeacherCommunityInbox,
  medianInstructorReplyHours,
} from "@/components/teacher/teacher-community-inbox";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  setCommunityPostAcceptedAnswer,
  setCommunityPostPinned,
} from "@/lib/data/community-posts";

/**
 * Mockup 5, 11d — for the teacher the community is an inbox:
 * "Waiting for an answer · N" at the top (oldest first, red after
 * 24 h), the answer written right there and already marked as The answer; "Post
 * an update" pins the notice; "This week" in numbers.
 */

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const HOUR = 3_600_000;

const mocks = vi.hoisted(() => ({
  auth: {
    status: "authenticated",
    user: { uid: "owner-1", email: "p@example.com", displayName: "Preston S.", roles: ["teacher"] },
  },
  postsCallback: null as null | ((posts: CommunityPost[]) => void),
  commentsCallback: null as null | ((comments: CommunityComment[]) => void),
}));

// The I18nProvider calls useRouter() for the refresh when switching language.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id: string, onNext: (course: unknown) => void) => {
    onNext({ id: "course-1", ownerId: "owner-1", title: "Leading Teams Through Change", enrollmentCount: 38 });
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
  createCommunityPost: vi.fn(() => Promise.resolve({ id: "post-new" })),
  createCommunityComment: vi.fn(() => Promise.resolve({ id: "comment-new" })),
  setCommunityPostAcceptedAnswer: vi.fn(() => Promise.resolve()),
  setCommunityPostPinned: vi.fn(() => Promise.resolve()),
  deleteCommunityPost: vi.fn(() => Promise.resolve()),
  deleteCommunityComment: vi.fn(() => Promise.resolve()),
  createCommunityReport: vi.fn(() => Promise.resolve()),
}));

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

function comment(overrides: Partial<CommunityComment>): CommunityComment {
  return {
    id: "c",
    postId: "p",
    courseSlug: "course-1",
    authorId: "student-3",
    authorName: "Lucas",
    authorRole: "student",
    body: "reply",
    createdAt: new Date(NOW - HOUR / 2).toISOString(),
    ...overrides,
  };
}

const posts: CommunityPost[] = [
  post({ id: "q-old", title: "How do you set a real deadline?", lessonTitle: "lesson 5", createdAt: new Date(NOW - 2 * 24 * HOUR).toISOString() }),
  post({ id: "q-new", title: "Is there a Portuguese version of the bias checklist?", authorName: "Lucas Melo", createdAt: new Date(NOW - 5 * HOUR).toISOString() }),
  post({ id: "q-done", title: "Do I lose progress if I skip?", acceptedCommentId: "c-done", createdAt: new Date(NOW - 3 * 24 * HOUR).toISOString() }),
  post({ id: "q-replied", title: "Where is the worksheet?", createdAt: new Date(NOW - 26 * HOUR).toISOString() }),
  post({ id: "share", category: "discussion", authorId: "student-4", authorName: "Marcos", body: "Removed two fake deadlines 🏆", createdAt: new Date(NOW - 20 * HOUR).toISOString() }),
];

const comments: CommunityComment[] = [
  comment({ id: "c-done", postId: "q-done", authorId: "owner-1", authorName: "Preston S.", authorRole: "teacher", createdAt: new Date(NOW - 3 * 24 * HOUR + 6 * HOUR).toISOString() }),
  comment({ id: "c-replied", postId: "q-replied", authorId: "owner-1", authorName: "Preston S.", authorRole: "teacher", createdAt: new Date(NOW - 24 * HOUR).toISOString() }),
  comment({ id: "c-student", postId: "q-old", authorId: "student-4", authorName: "Marcos" }),
];

async function renderInbox(locale?: "en" | "es") {
  const inbox = <TeacherCommunityInbox courseId="course-1" />;
  const view = render(
    locale ? <I18nProvider initialLocale={locale}>{inbox}</I18nProvider> : inbox,
  );
  await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
  await act(async () => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
  });
  return view;
}

describe("community inbox (teacher)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mocks.postsCallback = null;
    mocks.commentsCallback = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("header with members, active this week and the teacher's median response time", async () => {
    await renderInbox();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Leading Teams Through Change");
    // 38 members; active this week = those who posted or replied in the last 7
    // days: student-2 (default author), student-4 (Marcos) and owner-1 = 3;
    // median between 6h (q-done) and 2h (q-replied) = 4h.
    expect(screen.getByText(/38 members · 3 active this week · your median reply 4h/)).toBeInTheDocument();
  });

  it("'Waiting for an answer' lists only the teacher's unanswered questions, oldest first, red after 24 h", async () => {
    await renderInbox();

    const waiting = screen.getByRole("region", { name: /Waiting for an answer/ });
    const cards = within(waiting).getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("How do you set a real deadline?");
    expect(cards[0]).toHaveTextContent("lesson 5");
    expect(cards[0]).toHaveTextContent("waiting 2 days");
    expect(within(cards[0]).getByText("waiting 2 days")).toHaveClass("text-[var(--color-danger-fg)]");
    expect(cards[0]).toHaveTextContent("1 student reply so far");
    expect(cards[1]).toHaveTextContent("Portuguese version");
    expect(within(cards[1]).getByText("waiting 5 hours")).not.toHaveClass("text-[var(--color-danger-fg)]");
    expect(within(waiting).queryByText("Where is the worksheet?")).toBeNull();
    expect(within(waiting).queryByText("Do I lose progress if I skip?")).toBeNull();
  });

  it("replying right there creates the comment and marks it as THE answer", async () => {
    await renderInbox();

    const card = screen.getByRole("article", { name: "How do you set a real deadline?" });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    fireEvent.change(within(card).getByPlaceholderText("Write the answer here..."), {
      target: { value: "Show the constraint, not the pressure." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Post answer" }));

    await waitFor(() =>
      expect(createCommunityComment).toHaveBeenCalledWith(
        expect.objectContaining({ postId: "q-old", body: "Show the constraint, not the pressure." }),
      ),
    );
    await waitFor(() => expect(setCommunityPostAcceptedAnswer).toHaveBeenCalledWith("q-old", "comment-new"));
  });

  it("unchecking 'Mark as the answer' replies without marking", async () => {
    await renderInbox();

    const card = screen.getByRole("article", { name: "How do you set a real deadline?" });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    fireEvent.click(within(card).getByRole("checkbox", { name: /Mark as the answer/ }));
    fireEvent.change(within(card).getByPlaceholderText("Write the answer here..."), {
      target: { value: "Can you share the campaign first?" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Post answer" }));

    await waitFor(() => expect(createCommunityComment).toHaveBeenCalled());
    expect(setCommunityPostAcceptedAnswer).not.toHaveBeenCalled();
  });

  it("'Post an update' publishes the notice and pins it to the top", async () => {
    await renderInbox();

    fireEvent.click(screen.getByRole("button", { name: "Post an update" }));
    fireEvent.change(screen.getByPlaceholderText("What should the cohort know this week?"), {
      target: { value: "This week: persuasion you can defend." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));

    await waitFor(() =>
      expect(createCommunityPost).toHaveBeenCalledWith(
        expect.objectContaining({ courseSlug: "course-1", category: "announcement" }),
      ),
    );
    await waitFor(() => expect(setCommunityPostPinned).toHaveBeenCalledWith("post-new", true));
  });

  it("'This week' counts posts, questions, shares and active members", async () => {
    await renderInbox();

    // The 5 posts are from this week (the oldest is 3 days old): 4 questions + 1 share.
    expect(screen.getByText("5 posts")).toBeInTheDocument();
    expect(screen.getByText("4 questions · 1 share")).toBeInTheDocument();
    expect(screen.getByText("3 of 38 active")).toBeInTheDocument();
  });

  // The card called the time formatter without `t` or `locale`: in Spanish the
  // time of the learner's last reply came out in English ("30m ago").
  it("shows the time of the last learner reply in the person's language", async () => {
    await renderInbox("es");

    // In Spanish the whole card now comes out translated, not just the time.
    const waiting = screen.getByRole("region", { name: /Esperando respuesta/ });
    const [oldest] = within(waiting).getAllByRole("article");
    // c-student respondeu q-old ha meia hora (NOW - HOUR / 2).
    expect(oldest).toHaveTextContent("1 respuesta de alumnos hasta ahora");
    expect(oldest).toHaveTextContent("Hace 30 min");
  });

  // The database refuses the write with RATE_LIMIT (hourly cap, P2-9). The inbox
  // asks the person to wait, instead of the generic "try again" that would fail again.
  it("database hourly cap on the reply: asks to wait and marks nothing", async () => {
    vi.mocked(createCommunityComment).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    await renderInbox("en");

    const card = screen.getByRole("article", { name: "How do you set a real deadline?" });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    fireEvent.change(within(card).getByPlaceholderText("Write the answer here..."), {
      target: { value: "Show the constraint, not the pressure." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Post answer" }));

    expect(await screen.findByText("You've posted a lot in the last hour. Wait a little and try again.")).toBeInTheDocument();
    expect(screen.queryByText("We could not post your answer. Try again.")).toBeNull();
    expect(setCommunityPostAcceptedAnswer).not.toHaveBeenCalled();
  });

  it("database hourly cap on the notice: the same message, in Spanish, pins nothing", async () => {
    vi.mocked(createCommunityPost).mockRejectedValueOnce({ code: "P0001", message: "RATE_LIMIT" });
    await renderInbox("es");

    fireEvent.click(screen.getByRole("button", { name: "Publicar una novedad" }));
    fireEvent.change(screen.getByPlaceholderText("¿Qué debería saber el grupo esta semana?"), {
      target: { value: "This week: persuasion you can defend." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar novedad" }));

    expect(await screen.findByText("Publicaste mucho en la última hora. Espera un poco y vuelve a intentarlo.")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos publicar la novedad.")).toBeNull();
    expect(setCommunityPostPinned).not.toHaveBeenCalled();
  });
});

describe("'All posts': the teacher moderates their own community", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mocks.postsCallback = null;
    mocks.commentsCallback = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // The read (subscribeToCommunityPosts) already delivers pinned posts on top and the newest
  // first; the list shows them in that order.
  const update = post({ id: "update", category: "announcement", authorId: "owner-1", authorName: "Preston S.", body: "Live on Friday.", pinned: true, createdAt: new Date(NOW - 4 * 24 * HOUR).toISOString() });
  const ordered = [update, posts[1], posts[4], posts[3], posts[0], posts[2]];

  async function renderWithPinned() {
    await renderInbox();
    await act(async () => {
      mocks.postsCallback?.(ordered);
    });
    return screen.getByRole("region", { name: /All posts/ });
  }

  it("lists all posts in the order of the read, with the pinned one marked and the replies counted", async () => {
    const all = await renderWithPinned();

    const rows = within(all).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("Live on Friday.");
    expect(rows[0]).toHaveTextContent("pinned");
    expect(rows[1]).toHaveTextContent("Is there a Portuguese version of the bias checklist?");
    expect(rows[4]).toHaveTextContent("How do you set a real deadline?");
    expect(rows[4]).toHaveTextContent("1 reply");
    expect(rows[5]).toHaveTextContent("Do I lose progress if I skip?");
    expect(within(all).getByRole("heading", { level: 2 })).toHaveTextContent(/^All posts\s*6$/);
    // The owner moderates; they do not report their own course.
    expect(within(all).queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("unpinning uses the same write the database already allowed", async () => {
    const all = await renderWithPinned();

    fireEvent.click(within(within(all).getAllByRole("listitem")[0]).getByRole("button", { name: "Unpin" }));
    expect(setCommunityPostPinned).toHaveBeenCalledExactlyOnceWith("update", false);
  });

  it("deleting a learner's post asks for confirmation and removes the post from the list and the queue", async () => {
    const all = await renderWithPinned();
    const row = within(all).getAllByRole("listitem")[4];

    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityPost).toHaveBeenCalledExactlyOnceWith("q-old");
    expect(within(all).getAllByRole("listitem")).toHaveLength(5);
    expect(within(all).queryByText("How do you set a real deadline?")).toBeNull();
    const waiting = screen.getByRole("region", { name: /Waiting for an answer/ });
    expect(within(waiting).getAllByRole("article")).toHaveLength(1);
  });

  it("'Open' opens the drawer; there the teacher deletes a learner's reply", async () => {
    const all = await renderWithPinned();
    const row = within(all).getAllByRole("listitem")[4];

    const open = within(row).getByRole("button", { name: "Open" });
    expect(open).toHaveAccessibleDescription("How do you set a real deadline?");
    fireEvent.click(open);
    const drawer = screen.getByRole("dialog", { name: "How do you set a real deadline?" });
    const [reply] = within(drawer).getAllByRole("listitem");
    expect(reply).toHaveTextContent("reply");

    fireEvent.click(within(reply).getByRole("button", { name: "Delete" }));
    await act(async () => { fireEvent.click(within(reply).getByRole("button", { name: "Yes, delete" })); });

    expect(deleteCommunityComment).toHaveBeenCalledExactlyOnceWith("c-student");
    expect(within(drawer).getByText("No replies yet. Be the first.")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("teacher's median response time", () => {
  it("only counts questions the instructor answered; with none, there is no number", () => {
    expect(medianInstructorReplyHours(posts, comments, ["owner-1"])).toBe(4);
    expect(medianInstructorReplyHours(posts, [], ["owner-1"])).toBeNull();
  });
});

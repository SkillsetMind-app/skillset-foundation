import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommunityFeed } from "@/components/learn/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { CommunitySpace } from "@/domain/learning";
import { createCommunityPost } from "@/lib/data/community-posts";

/**
 * Mockup 5, rodada 11 — o feed simplificado, renderizado de verdade:
 *  - tres filtros (All · Questions com abertas · From <instrutor>), busca;
 *  - "Ask a question" expande no lugar, com a aula anexada e perguntas
 *    parecidas ja respondidas;
 *  - cartao leve: instrutor, pinned, "from lesson 5", Question -> Answered,
 *    a primeira resposta DENTRO do cartao (a aceita em verde);
 *  - posts de outras pessoas viram a pilula "N new posts" em vez de empurrar
 *    a tela; os proprios entram na hora;
 *  - coluna lateral: live que vira "Join", quem esta online, "Say hi" so na
 *    primeira semana.
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
  // vi.hoisted roda antes das constantes do modulo: data literal (NOW - 2 dias).
  enrollmentCreatedAt: "2026-08-31T12:00:00.000Z",
  subscriptions: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/learn/courses/course-1/community",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (e: unknown) => void) => {
    mocks.subscriptions += 1;
    if (mocks.subscriptions > 20) {
      throw new Error("subscribeToEnrollment em laco");
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

async function renderFeed(props: Partial<Parameters<typeof CommunityFeed>[0]> = {}) {
  const view = render(<CommunityFeed space={space} instructorName="Patrick" {...props} />);
  await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
  await act(async () => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
    mocks.eventsCallback?.([]);
    mocks.presenceCallback?.([]);
  });
  return view;
}

describe("feed da comunidade (rodada 11)", () => {
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

  it("tres filtros: All com o fixado no topo; Questions conta as abertas; From Patrick so o instrutor", async () => {
    await renderFeed();

    const cards = screen.getAllByRole("article");
    expect(cards[0]).toHaveTextContent("Patrick S.");
    expect(cards[0]).toHaveTextContent("Instructor");
    expect(cards[0]).toHaveTextContent("pinned");
    expect(cards).toHaveLength(4);

    fireEvent.click(screen.getByRole("tab", { name: "Questions · 1 open" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "From Patrick" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("This week: persuasion");

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search posts" }), {
      target: { value: "portuguese" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveTextContent("Portuguese version");
  });

  it("cartao: Answered com a resposta aceita DENTRO (em verde), 'from lesson 5', 'View 3 replies'; a aberta diz Question", async () => {
    await renderFeed();

    const answered = screen.getByRole("article", { name: /real deadline/ });
    expect(answered).toHaveTextContent("Answered");
    expect(answered).toHaveTextContent("from lesson 5");
    expect(within(answered).getByText("Show the constraint, not the pressure.")).toBeInTheDocument();
    expect(within(answered).queryByText("Following, same problem here.")).toBeNull();
    expect(within(answered).getByText("answer")).toBeInTheDocument();
    expect(within(answered).getByRole("button", { name: "View 3 replies" })).toBeInTheDocument();

    fireEvent.click(within(answered).getByRole("button", { name: "View 3 replies" }));
    expect(within(answered).getByText("Following, same problem here.")).toBeInTheDocument();

    const open = screen.getByRole("article", { name: /Portuguese version/ });
    expect(open).toHaveTextContent("Question");
    expect(open).not.toHaveTextContent("Answered");
  });

  it("Ask a question: expande no lugar, com a aula anexada (removivel) e perguntas parecidas ja respondidas", async () => {
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

  it("tirar a aula anexada manda a pergunta sem aula", async () => {
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

  it("post novo de OUTRA pessoa vira a pilula '1 new post'; o meu entra na hora", async () => {
    await renderFeed();
    expect(screen.getAllByRole("article")).toHaveLength(4);

    const fromOther = post({ id: "new-other", authorId: "student-9", authorName: "Pedro Alves", category: "discussion", body: "Anyone tried the worksheet?", createdAt: new Date(NOW).toISOString() });
    await act(async () => {
      mocks.postsCallback?.([fromOther, ...posts]);
    });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.queryByText("Anyone tried the worksheet?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 new post" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByText("Anyone tried the worksheet?")).toBeInTheDocument();

    const mine = post({ id: "mine", authorId: "student-1", authorName: "Ana Ribeiro", category: "discussion", body: "My own share.", createdAt: new Date(NOW).toISOString() });
    await act(async () => {
      mocks.postsCallback?.([mine, fromOther, ...posts]);
    });
    expect(screen.getByText("My own share.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new post/ })).toBeNull();
  });

  it("lateral: 'Live in 40 min' vira 'Join' quando comeca; quem esta online; 'Say hi' so na primeira semana", async () => {
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
    expect(live).toHaveTextContent("Join when it starts");
    expect(within(live).queryByRole("link", { name: "Join" })).toBeNull();
    expect(screen.getByText(/2 online/)).toBeInTheDocument();
    expect(screen.getByText("New here? Say hi 👋")).toBeInTheDocument();

    await act(async () => {
      vi.setSystemTime(NOW + 41 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(within(screen.getByRole("region", { name: "Next live" })).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "https://zoom.us/j/1",
    );
  });

  it("quem esta ha mais de uma semana nao ve o 'Say hi'", async () => {
    mocks.enrollmentCreatedAt = new Date(NOW - 30 * 24 * HOUR).toISOString();
    await renderFeed();

    expect(screen.queryByText("New here? Say hi 👋")).toBeNull();
  });
});

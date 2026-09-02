import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TeacherCommunityInbox,
  medianInstructorReplyHours,
} from "@/components/teacher/teacher-community-inbox";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityComment,
  createCommunityPost,
  setCommunityPostAcceptedAnswer,
  setCommunityPostPinned,
} from "@/lib/data/community-posts";

/**
 * Mockup 5, 11d — para o professor a comunidade e uma caixa de entrada:
 * "Waiting for an answer · N" no topo (mais antiga primeiro, vermelha depois
 * de 24 h), a resposta escrita ali mesmo e ja marcada como A resposta; "Post
 * an update" fixa o aviso; "This week" em numeros.
 */

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const HOUR = 3_600_000;

const mocks = vi.hoisted(() => ({
  auth: {
    status: "authenticated",
    user: { uid: "owner-1", email: "p@example.com", displayName: "Patrick S.", roles: ["teacher"] },
  },
  postsCallback: null as null | ((posts: CommunityPost[]) => void),
  commentsCallback: null as null | ((comments: CommunityComment[]) => void),
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
  comment({ id: "c-done", postId: "q-done", authorId: "owner-1", authorName: "Patrick S.", authorRole: "teacher", createdAt: new Date(NOW - 3 * 24 * HOUR + 6 * HOUR).toISOString() }),
  comment({ id: "c-replied", postId: "q-replied", authorId: "owner-1", authorName: "Patrick S.", authorRole: "teacher", createdAt: new Date(NOW - 24 * HOUR).toISOString() }),
  comment({ id: "c-student", postId: "q-old", authorId: "student-4", authorName: "Marcos" }),
];

async function renderInbox() {
  const view = render(<TeacherCommunityInbox courseId="course-1" />);
  await waitFor(() => expect(mocks.postsCallback).not.toBeNull());
  await act(async () => {
    mocks.postsCallback?.(posts);
    mocks.commentsCallback?.(comments);
  });
  return view;
}

describe("caixa de entrada da comunidade (professor)", () => {
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

  it("cabecalho com membros, ativos na semana e a mediana de resposta do professor", async () => {
    await renderInbox();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Leading Teams Through Change");
    // 38 membros; ativos na semana = quem postou ou respondeu nos ultimos 7
    // dias: student-2 (autor padrao), student-4 (Marcos) e owner-1 = 3;
    // mediana entre 6h (q-done) e 2h (q-replied) = 4h.
    expect(screen.getByText(/38 members · 3 active this week · your median reply 4h/)).toBeInTheDocument();
  });

  it("'Waiting for an answer' lista so as perguntas sem resposta do professor, mais antiga primeiro, vermelha depois de 24 h", async () => {
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

  it("responder ali mesmo cria o comentario e ja marca como A resposta", async () => {
    await renderInbox();

    const card = screen.getByRole("article", { name: "How do you set a real deadline?" });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    fireEvent.change(within(card).getByPlaceholderText("Write the answer here…"), {
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

  it("desmarcar 'Mark as the answer' responde sem marcar", async () => {
    await renderInbox();

    const card = screen.getByRole("article", { name: "How do you set a real deadline?" });
    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    fireEvent.click(within(card).getByRole("checkbox", { name: /Mark as the answer/ }));
    fireEvent.change(within(card).getByPlaceholderText("Write the answer here…"), {
      target: { value: "Can you share the campaign first?" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Post answer" }));

    await waitFor(() => expect(createCommunityComment).toHaveBeenCalled());
    expect(setCommunityPostAcceptedAnswer).not.toHaveBeenCalled();
  });

  it("'Post an update' publica o aviso e o fixa no topo", async () => {
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

  it("'This week' conta posts, perguntas, compartilhamentos e ativos", async () => {
    await renderInbox();

    // Os 5 posts sao desta semana (o mais antigo tem 3 dias): 4 perguntas + 1 compartilhamento.
    expect(screen.getByText("5 posts")).toBeInTheDocument();
    expect(screen.getByText("4 questions · 1 share")).toBeInTheDocument();
    expect(screen.getByText("3 of 38 active")).toBeInTheDocument();
  });
});

describe("mediana de resposta do professor", () => {
  it("so conta perguntas que o instrutor respondeu; sem nenhuma, nao ha numero", () => {
    expect(medianInstructorReplyHours(posts, comments, ["owner-1"])).toBe(4);
    expect(medianInstructorReplyHours(posts, [], ["owner-1"])).toBeNull();
  });
});

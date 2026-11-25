import { describe, expect, it } from "vitest";

import {
  countOpenQuestions,
  filterPosts,
  findSimilarAnswered,
  groupCommentsByPost,
  isAnswered,
  openQuestions,
  pickInlineReply,
  postKind,
  waitingFor,
  weekSummary,
  withoutDeleted,
} from "@/domain/community-feed";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";

// Mockup 5, wave 11: the pure part of the simplified community.

const DAY = 24 * 3_600_000;
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

function post(overrides: Partial<CommunityPost>): CommunityPost {
  return {
    id: "p",
    courseSlug: "course-1",
    authorId: "student-1",
    authorName: "Carla",
    authorRole: "student",
    category: "question",
    body: "body",
    createdAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

function comment(overrides: Partial<CommunityComment>): CommunityComment {
  return {
    id: "c",
    postId: "p",
    courseSlug: "course-1",
    authorId: "student-2",
    authorName: "Marcos",
    authorRole: "student",
    body: "reply",
    createdAt: new Date(NOW - DAY / 2).toISOString(),
    ...overrides,
  };
}

describe("what each post is", () => {
  it("question, share or instructor notice, on top of the category that already existed", () => {
    expect(postKind(post({ category: "question" }))).toBe("question");
    expect(postKind(post({ category: "discussion" }))).toBe("share");
    expect(postKind(post({ category: "resource" }))).toBe("share");
    expect(postKind(post({ category: "announcement" }))).toBe("update");
  });

  it("answered = question with an accepted answer; a share is never 'answered'", () => {
    expect(isAnswered(post({ acceptedCommentId: "c1" }))).toBe(true);
    expect(isAnswered(post({ acceptedCommentId: null }))).toBe(false);
    expect(isAnswered(post({ category: "discussion", acceptedCommentId: "c1" }))).toBe(false);
  });
});

describe("three filters", () => {
  const posts = [
    post({ id: "q-open", category: "question", createdAt: new Date(NOW - 3 * DAY).toISOString() }),
    post({ id: "q-done", category: "question", acceptedCommentId: "c1" }),
    post({ id: "share", category: "discussion", authorId: "student-2" }),
    post({ id: "pinned-update", category: "announcement", authorId: "teacher-1", authorRole: "teacher", pinned: true, createdAt: new Date(NOW - 10 * DAY).toISOString() }),
    post({ id: "owner-share", category: "discussion", authorId: "owner-1", authorRole: "student" }),
  ];

  it("All: everything, pinned at the top even if it is the oldest", () => {
    expect(filterPosts(posts, "all").map((p) => p.id)).toEqual([
      "pinned-update",
      "q-done",
      "share",
      "owner-share",
      "q-open",
    ]);
  });

  it("Questions: only questions; the counter says how many are open", () => {
    expect(filterPosts(posts, "questions").map((p) => p.id)).toEqual(["q-done", "q-open"]);
    expect(countOpenQuestions(posts)).toBe(1);
  });

  it("From <instructor>: teacher role OR owner of the course", () => {
    expect(filterPosts(posts, "instructor", ["owner-1"]).map((p) => p.id)).toEqual([
      "pinned-update",
      "owner-share",
    ]);
  });

  it("search looks at title and body", () => {
    const withTitle = [post({ id: "t", title: "Deadline as manipulation", body: "x" })];
    expect(filterPosts(withTitle, "all", [], "MANIPULATION")).toHaveLength(1);
    expect(filterPosts(withTitle, "all", [], "banana")).toHaveLength(0);
  });
});

describe("the answer inside the card", () => {
  const comments = [
    comment({ id: "first", createdAt: new Date(NOW - DAY).toISOString() }),
    comment({ id: "teacher", authorId: "teacher-1", authorRole: "teacher", createdAt: new Date(NOW - DAY / 2).toISOString() }),
    comment({ id: "nested", parentId: "first", createdAt: new Date(NOW - DAY / 4).toISOString() }),
    comment({ id: "other-post", postId: "p2" }),
  ];

  it("the accepted one beats all the others", () => {
    expect(pickInlineReply(post({ acceptedCommentId: "nested" }), comments)?.id).toBe("nested");
  });

  it("no accepted one: the instructor's; no instructor: the first top-level one", () => {
    expect(pickInlineReply(post({}), comments)?.id).toBe("teacher");
    expect(pickInlineReply(post({}), comments.filter((c) => c.id !== "teacher"))?.id).toBe("first");
    expect(pickInlineReply(post({ id: "p3" }), comments)).toBeNull();
  });

  it("groups by post, oldest first", () => {
    const grouped = groupCommentsByPost(comments);
    expect(grouped.get("p")?.map((c) => c.id)).toEqual(["first", "teacher", "nested"]);
    expect(grouped.get("p2")).toHaveLength(1);
  });
});

describe("similar questions that are already answered", () => {
  const posts = [
    post({ id: "a", title: "Do I lose progress if I skip a lesson?", body: "", acceptedCommentId: "c" }),
    post({ id: "b", title: "How do you set a real deadline for someone?", body: "", acceptedCommentId: "c" }),
    post({ id: "c-open", title: "Can I skip the reading and keep my progress?", body: "" }),
  ];

  it("only suggests answered ones, and only with two words of 4+ letters in common", () => {
    expect(findSimilarAnswered("Can I skip the reading and come back without losing progress?", posts).map((p) => p.id)).toEqual(["a"]);
    expect(findSimilarAnswered("deadline", posts)).toEqual([]);
    expect(findSimilarAnswered("real deadline someone", posts).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("the teacher's inbox", () => {
  it("open = no accepted answer AND no instructor answer, oldest first", () => {
    const posts = [
      post({ id: "new", createdAt: new Date(NOW - DAY / 4).toISOString() }),
      post({ id: "old", createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      post({ id: "answered", acceptedCommentId: "c1" }),
      post({ id: "teacher-replied" }),
      post({ id: "share", category: "discussion" }),
    ];
    const comments = [
      comment({ id: "c1", postId: "answered" }),
      comment({ id: "t", postId: "teacher-replied", authorId: "owner-1" }),
    ];

    expect(openQuestions(posts, comments, ["owner-1"]).map((p) => p.id)).toEqual(["old", "new"]);
  });

  it("'waiting' turns red after 24 h", () => {
    expect(waitingFor(post({ createdAt: new Date(NOW - 5 * 3_600_000).toISOString() }), NOW)).toEqual({
      label: "waiting 5 hours",
      overdue: false,
    });
    expect(waitingFor(post({ createdAt: new Date(NOW - 2 * DAY).toISOString() }), NOW)).toEqual({
      label: "waiting 2 days",
      overdue: true,
    });
    expect(waitingFor(post({ createdAt: new Date(NOW - 90_000).toISOString() }), NOW)).toEqual({
      label: "waiting 1 min",
      overdue: false,
    });
  });

  it("'this week' counts posts, questions, shares and who took part", () => {
    const posts = [
      post({ id: "1", authorId: "a" }),
      post({ id: "2", category: "discussion", authorId: "b" }),
      post({ id: "old", createdAt: new Date(NOW - 9 * DAY).toISOString(), authorId: "z" }),
    ];
    const comments = [comment({ id: "c", authorId: "c" }), comment({ id: "same", authorId: "a" })];

    expect(weekSummary(posts, comments, NOW)).toEqual({
      posts: 2,
      questions: 1,
      shares: 1,
      activeMembers: 3,
    });
  });
});

describe("what was just deleted", () => {
  it("disappears from the screen with its answers, like the database cascade", () => {
    const replies = [
      { id: "c-1", postId: "p-gone", parentId: null },
      { id: "c-2", postId: "p-kept", parentId: null },
      { id: "c-3", postId: "p-kept", parentId: "c-gone" },
      { id: "c-gone", postId: "p-kept", parentId: null },
    ];

    expect(withoutDeleted(replies, new Set(["p-gone", "c-gone"])).map((reply) => reply.id)).toEqual(["c-2"]);
  });

  it("with nothing deleted returns the same list (the useMemo calls do not recompute for nothing)", () => {
    const posts = [{ id: "p-1" }];
    expect(withoutDeleted(posts, new Set())).toBe(posts);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  countOpenCommunityQuestions,
  createCommunityReport,
  deleteCommunityComment,
  deleteCommunityPost,
  setCommunityPostPinned,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";

// The community reads and deletes from the browser. Here the query itself is checked:
// the window of 200 posts and 2000 replies takes the NEWEST, and deleting only
// says "deleted" when the database really deleted (RLS refuses silently).

type Call = [method: string, args: unknown[]];

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  count: null as number | null,
  error: null as unknown,
  calls: {} as Record<string, Call[]>,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    const channel: Record<string, unknown> = { on: () => channel, subscribe: () => channel };
    return {
      channel: () => channel,
      removeChannel: () => Promise.resolve(),
      from(table: string) {
        const calls: Call[] = (db.calls[table] = []);
        const query: Record<string, unknown> = new Proxy({}, {
          get(_target, method: string) {
            if (method === "then") {
              return (resolve: (value: unknown) => void) =>
                resolve({ data: db.rows[table] ?? [], error: db.error, count: db.count });
            }
            return (...args: unknown[]) => {
              calls.push([method, args]);
              return query;
            };
          },
        });
        return query;
      },
    };
  },
}));

afterEach(() => {
  db.rows = {};
  db.calls = {};
  db.count = null;
  db.error = null;
});

function postRow(id: string, createdAt: string, pinned = false) {
  return { id, course_slug: "course-1", author_id: "u-1", author_name: "Ana", author_role: "student",
    category: "discussion", body: id, pinned, created_at: createdAt, updated_at: createdAt };
}

function commentRow(id: string, createdAt: string) {
  return { id, post_id: "p-1", course_slug: "course-1", author_id: "u-2", author_name: "Bia",
    author_role: "student", body: id, parent_id: null, created_at: createdAt, updated_at: createdAt };
}

describe("the board reads the newest", () => {
  it("asks the database for the pinned ones and then the newest, before the cap of 200", async () => {
    // The database returns in the requested order.
    db.rows.community_posts = [
      postRow("pinned-old", "2026-09-01T00:00:00Z", true),
      postRow("new", "2026-10-08T00:00:00Z"),
      postRow("old", "2026-09-02T00:00:00Z"),
    ];
    const onPosts = vi.fn<(posts: CommunityPost[]) => void>();

    const stop = subscribeToCommunityPosts("course-1", onPosts, vi.fn());
    await vi.waitFor(() => expect(onPosts).toHaveBeenCalled());
    stop();

    expect(db.calls.community_posts).toEqual([
      ["select", ["*"]],
      ["eq", ["course_slug", "course-1"]],
      ["order", ["pinned", { ascending: false, nullsFirst: false }]],
      ["order", ["created_at", { ascending: false, nullsFirst: false }]],
      ["limit", [200]],
    ]);
    expect(onPosts.mock.calls[0][0].map((post) => post.id)).toEqual(["pinned-old", "new", "old"]);
  });

  it("keeps the 2000 newest replies and delivers from the oldest to the newest", async () => {
    db.rows.community_comments = [
      commentRow("c-3", "2026-10-08T00:00:00Z"),
      commentRow("c-2", "2026-10-07T00:00:00Z"),
      commentRow("c-1", "2026-10-06T00:00:00Z"),
    ];
    const onComments = vi.fn<(comments: CommunityComment[]) => void>();

    const stop = subscribeToCourseCommunityComments("course-1", onComments, vi.fn());
    await vi.waitFor(() => expect(onComments).toHaveBeenCalled());
    stop();

    expect(db.calls.community_comments).toEqual([
      ["select", ["*"]],
      ["eq", ["course_slug", "course-1"]],
      ["order", ["created_at", { ascending: false, nullsFirst: false }]],
      ["limit", [2000]],
    ]);
    expect(onComments.mock.calls[0][0].map((comment) => comment.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});

describe("deleting a post or reply", () => {
  it.each([
    ["post", deleteCommunityPost, "community_posts"],
    ["resposta", deleteCommunityComment, "community_comments"],
  ] as const)("%s: deletes by id and asks for the count", async (_label, remove, table) => {
    db.count = 1;

    await expect(remove("row-1")).resolves.toBeUndefined();

    expect(db.calls[table]).toEqual([
      ["delete", [{ count: "exact" }]],
      ["eq", ["id", "row-1"]],
    ]);
  });

  it.each([
    ["post", deleteCommunityPost],
    ["resposta", deleteCommunityComment],
  ] as const)("%s: RLS refused (0 rows) becomes an error, never 'deleted'", async (_label, remove) => {
    db.count = 0;
    await expect(remove("row-1")).rejects.toThrow("community_delete_refused");
  });

  it("the database error bubbles up as it came", async () => {
    db.error = { code: "42501", message: "permission denied" };
    await expect(deleteCommunityPost("row-1")).rejects.toEqual({ code: "42501", message: "permission denied" });
  });
});

describe("pinning and unpinning", () => {
  it("changes only pinned and updated_at, by id, and asks for the count", async () => {
    db.count = 1;

    await expect(setCommunityPostPinned("p-1", true)).resolves.toBeUndefined();

    expect(db.calls.community_posts).toEqual([
      ["update", [{ pinned: true, updated_at: expect.any(String) }, { count: "exact" }]],
      ["eq", ["id", "p-1"]],
    ]);
  });

  it("RLS refused (0 rows) becomes an error: the button does not fail silently", async () => {
    db.count = 0;
    await expect(setCommunityPostPinned("p-1", false)).rejects.toThrow("community_pin_refused");
  });

  it("the database error bubbles up as it came", async () => {
    db.error = { code: "42501", message: "permission denied" };
    await expect(setCommunityPostPinned("p-1", false)).rejects.toEqual({ code: "42501", message: "permission denied" });
  });
});

describe("open-questions counter of the tab", () => {
  it("asks the database only for questions without an accepted answer, newest first, before the cap of 200", async () => {
    db.rows.community_posts = [
      { category: "question", accepted_comment_id: null },
      { category: "question", accepted_comment_id: null },
    ];

    await expect(countOpenCommunityQuestions("course-1")).resolves.toBe(2);

    expect(db.calls.community_posts).toEqual([
      ["select", ["category, accepted_comment_id"]],
      ["eq", ["course_slug", "course-1"]],
      ["eq", ["category", "question"]],
      ["is", ["accepted_comment_id", null]],
      ["order", ["created_at", { ascending: false, nullsFirst: false }]],
      ["limit", [200]],
    ]);
  });

  it("the domain rule still applies to what the database returned", async () => {
    db.rows.community_posts = [
      { category: "question", accepted_comment_id: "c-1" },
      { category: "discussion", accepted_comment_id: null },
      { category: "question", accepted_comment_id: null },
    ];
    await expect(countOpenCommunityQuestions("course-1")).resolves.toBe(1);
  });
});

describe("denunciar", () => {
  it("stores the open report in the /ops queue, with the target and who reported it", async () => {
    await createCommunityReport({
      courseSlug: "course-1",
      postId: "p-1",
      commentId: "c-1",
      targetType: "comment",
      targetAuthorId: "u-2",
      targetAuthorName: "Bia",
      reason: "harassment",
      detail: "  Insulted another member.  ",
      user: { uid: "u-3", email: "caio@example.test", emailVerified: true, displayName: "Caio", photoURL: null, roles: ["student"] },
    });

    expect(db.calls.community_reports).toEqual([
      ["insert", [expect.objectContaining({
        course_slug: "course-1",
        post_id: "p-1",
        comment_id: "c-1",
        target_type: "comment",
        target_author_id: "u-2",
        target_author_name: "Bia",
        reporter_id: "u-3",
        reporter_name: "Caio",
        reason: "harassment",
        detail: "Insulted another member.",
        status: "open",
      })]],
    ]);
  });
});

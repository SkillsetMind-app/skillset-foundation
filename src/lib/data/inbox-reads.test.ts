import { afterEach, describe, expect, it, vi } from "vitest";

import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { countThreadsAwaitingTeacher } from "@/lib/data/course-messages";

// The reads of the Inbox count run on EVERY teacher page.
// Here the query itself is checked: newest first, filters in the
// database and only the columns the count uses (no message text).

type Call = [method: string, args: unknown[]];

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  calls: {} as Record<string, Call[]>,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    from(table: string) {
      const calls: Call[] = (db.calls[table] = []);
      const query: Record<string, unknown> = new Proxy({}, {
        get(_target, method: string) {
          if (method === "then") {
            return (resolve: (value: unknown) => void) => resolve({ data: db.rows[table] ?? [], error: null });
          }
          return (...args: unknown[]) => {
            calls.push([method, args]);
            return query;
          };
        },
      });
      return query;
    },
  }),
}));

afterEach(() => {
  db.rows = {};
  db.calls = {};
});

describe("questions waiting for the teacher", () => {
  it("reads the newest first, filters in the database and only the ids", async () => {
    // The database returns in the requested order: from newest to oldest.
    db.rows.community_posts = [{ id: "p-3" }, { id: "p-2" }, { id: "p-1" }];
    // The teacher already answered p-2 (without marking it as accepted).
    db.rows.community_comments = [{ post_id: "p-2" }];

    const open = await getOpenCommunityQuestions(["c-1", "c-2"], "teacher-1");

    expect(open).toEqual(["p-3", "p-1"]);
    expect(db.calls.community_posts).toEqual([
      ["select", ["id"]],
      ["in", ["course_slug", ["c-1", "c-2"]]],
      ["eq", ["category", "question"]],
      ["is", ["accepted_comment_id", null]],
      ["order", ["created_at", { ascending: false }]],
      ["limit", [200]],
    ]);
    // Of the replies, only the instructor ones (the isInstructor rule) and only post_id.
    expect(db.calls.community_comments).toEqual([
      ["select", ["post_id"]],
      ["in", ["post_id", ["p-3", "p-2", "p-1"]]],
      ["or", ["author_role.in.(teacher,admin),author_id.eq.teacher-1"]],
      ["limit", [2000]],
    ]);
  });

  it("with no community connected, it does not even ask the database", async () => {
    expect(await getOpenCommunityQuestions([], "teacher-1")).toEqual([]);
    expect(db.calls.community_posts).toBeUndefined();
  });
});

describe("conversations waiting for the teacher", () => {
  it("reads only who sent it and when, from the 400 newest, and counts the ones that end with the learner", async () => {
    db.rows.course_messages = [
      { course_id: "c-1", student_id: "s-1", sender_id: "s-1", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "c-1", student_id: "s-2", sender_id: "teacher-1", created_at: "2026-10-02T00:00:00Z" },
      { course_id: "c-1", student_id: "s-1", sender_id: "teacher-1", created_at: "2026-10-01T00:00:00Z" },
      { course_id: "c-1", student_id: "s-2", sender_id: "s-2", created_at: "2026-10-01T00:00:00Z" },
    ];

    expect(await countThreadsAwaitingTeacher("teacher-1")).toBe(1);
    expect(db.calls.course_messages).toEqual([
      ["select", ["course_id, student_id, sender_id, created_at"]],
      ["eq", ["teacher_id", "teacher-1"]],
      ["order", ["created_at", { ascending: false }]],
      ["limit", [400]],
    ]);
  });
});

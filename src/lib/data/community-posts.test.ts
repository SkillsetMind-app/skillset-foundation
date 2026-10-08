import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import {
  createCommunityReport,
  deleteCommunityComment,
  deleteCommunityPost,
  subscribeToCommunityPosts,
  subscribeToCourseCommunityComments,
} from "@/lib/data/community-posts";

// A comunidade le e apaga pelo navegador. Aqui se confere a consulta em si:
// a janela de 200 posts e de 2000 respostas pega as MAIS NOVAS, e apagar so
// diz "apagado" quando o banco apagou de fato (a RLS recusa em silencio).

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

describe("o mural le os mais novos", () => {
  it("pede ao banco os fixados e depois os mais novos, antes do teto de 200", async () => {
    // O banco devolve na ordem pedida.
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

  it("guarda as 2000 respostas mais novas e entrega da mais antiga para a mais nova", async () => {
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

describe("apagar post ou resposta", () => {
  it.each([
    ["post", deleteCommunityPost, "community_posts"],
    ["resposta", deleteCommunityComment, "community_comments"],
  ] as const)("%s: apaga pelo id e pede a contagem", async (_label, remove, table) => {
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
  ] as const)("%s: a RLS recusou (0 linhas) vira erro, nunca 'apagado'", async (_label, remove) => {
    db.count = 0;
    await expect(remove("row-1")).rejects.toThrow("community_delete_refused");
  });

  it("o erro do banco sobe como veio", async () => {
    db.error = { code: "42501", message: "permission denied" };
    await expect(deleteCommunityPost("row-1")).rejects.toEqual({ code: "42501", message: "permission denied" });
  });
});

describe("denunciar", () => {
  it("grava a denuncia aberta na fila do /ops, com o alvo e quem denunciou", async () => {
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

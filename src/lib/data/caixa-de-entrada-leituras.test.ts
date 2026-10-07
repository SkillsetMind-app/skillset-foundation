import { afterEach, describe, expect, it, vi } from "vitest";

import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { countThreadsAwaitingTeacher } from "@/lib/data/course-messages";

// As leituras do numero da Caixa de entrada rodam em TODA pagina do professor.
// Aqui se confere a consulta em si: as mais novas primeiro, os filtros no
// banco e so as colunas que a conta usa (nada de texto de mensagem).

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

describe("perguntas que esperam pelo professor", () => {
  it("le as mais novas primeiro, filtra no banco e so os ids", async () => {
    // O banco devolve na ordem pedida: da mais nova para a mais velha.
    db.rows.community_posts = [{ id: "p-3" }, { id: "p-2" }, { id: "p-1" }];
    // O professor ja respondeu a p-2 (sem marcar como aceita).
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
    // Das respostas, so as de instrutor (a regra de isInstructor) e so post_id.
    expect(db.calls.community_comments).toEqual([
      ["select", ["post_id"]],
      ["in", ["post_id", ["p-3", "p-2", "p-1"]]],
      ["or", ["author_role.in.(teacher,admin),author_id.eq.teacher-1"]],
      ["limit", [2000]],
    ]);
  });

  it("sem comunidade ligada, nem pergunta ao banco", async () => {
    expect(await getOpenCommunityQuestions([], "teacher-1")).toEqual([]);
    expect(db.calls.community_posts).toBeUndefined();
  });
});

describe("conversas que esperam pelo professor", () => {
  it("le so quem mandou e quando, das 400 mais novas, e conta as que terminam no aluno", async () => {
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

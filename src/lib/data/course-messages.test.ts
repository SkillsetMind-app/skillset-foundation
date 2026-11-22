import { describe, expect, it, vi } from "vitest";

// O "Try again" da caixa do aluno e a releitura que uma mensagem nova dispara
// podem voltar fora de ordem. So a leitura mais nova entrega: a antiga traria a
// conversa sem a mensagem nova, ate o proximo evento.

type Answer = { data: unknown[] | null; error: Error | null };

const fake = vi.hoisted(() => ({
  reads: [] as Array<(answer: Answer) => void>,
  onChange: (() => undefined) as () => void,
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => new Promise<Answer>((resolve) => fake.reads.push(resolve)),
    };
    const channel = {
      on: (_event: string, _filter: unknown, handler: () => void) => {
        fake.onChange = handler;
        return channel;
      },
      subscribe: () => channel,
    };
    return { from: () => query, channel: () => channel, removeChannel: fake.removeChannel };
  },
}));

const { subscribeToStudentMessages } = await import("@/lib/data/course-messages");

function row(id: string) {
  return {
    id,
    course_id: "c-1",
    course_title: "Leadership",
    student_id: "s-1",
    student_name: "Ana",
    teacher_id: "t-1",
    sender_id: "t-1",
    body: id,
    created_at: "2026-11-22T10:00:00.000Z",
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("subscribeToStudentMessages", () => {
  it("so a leitura mais nova entrega, mesmo que a antiga volte depois", async () => {
    const callback = vi.fn();
    const onError = vi.fn();
    const subscription = subscribeToStudentMessages("s-1", callback, onError);

    fake.reads[0]({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    // "Try again" (leitura 2) e, antes de ela voltar, uma mensagem nova (leitura 3).
    void subscription.reload();
    fake.onChange();
    fake.reads[2]({ data: [row("nova"), row("velha")], error: null });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    fake.reads[1]({ data: [row("velha")], error: null });
    await settle();

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toHaveLength(2);
    expect(fake.removeChannel).not.toHaveBeenCalled();

    // Desligada, a leitura que ainda volte nao entrega nada.
    fake.onChange();
    subscription();
    fake.reads[3]({ data: [], error: null });
    await settle();
    expect(callback).toHaveBeenCalledOnce();
  });
});

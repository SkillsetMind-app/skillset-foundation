import { describe, expect, it, vi } from "vitest";

// O "Try again" do sino e a releitura que um aviso novo dispara podem voltar
// fora de ordem. So a leitura mais nova entrega: a antiga traria a lista sem
// o aviso novo, e ela ficaria assim ate o proximo evento.

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

const { subscribeToNotifications } = await import("@/lib/data/notifications");

function row(id: string) {
  return {
    notification_id: id,
    type: "support_reply",
    title: "",
    body: "",
    read: false,
    link: null,
    actor_name: null,
    params: null,
    created_at: "2026-11-22T10:00:00.000Z",
  };
}

describe("subscribeToNotifications", () => {
  it("so a leitura mais nova entrega, mesmo que a antiga volte depois", async () => {
    const callback = vi.fn();
    const onError = vi.fn();
    const subscription = subscribeToNotifications("u-1", callback, onError);

    // 1a leitura falha: o sino mostra o erro.
    fake.reads[0]({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    // "Try again" (leitura 2) e, antes de ela voltar, um aviso novo (leitura 3).
    void subscription.reload();
    fake.onChange();
    expect(fake.reads).toHaveLength(3);

    // A leitura 3 volta primeiro, com o aviso novo; a 2 volta depois, velha.
    fake.reads[2]({ data: [row("new"), row("old")], error: null });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    fake.reads[1]({ data: [row("old")], error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].map((item: { id: string }) => item.id)).toEqual(["new", "old"]);
    expect(onError).toHaveBeenCalledOnce();
    // A releitura nao mexe no canal.
    expect(fake.removeChannel).not.toHaveBeenCalled();

    // Desligado, uma leitura que ainda volte nao entrega mais nada.
    fake.onChange();
    subscription();
    fake.reads[3]({ data: [], error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });
});

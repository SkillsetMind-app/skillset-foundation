import { describe, expect, it, vi } from "vitest";

// The bell's "Try again" and the re-read that a new notice triggers can come back
// out of order. Only the newest read delivers: the old one would bring the list
// without the new notice, and it would stay that way until the next event.

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
  it("only the newest read delivers, even if the old one comes back later", async () => {
    const callback = vi.fn();
    const onError = vi.fn();
    const subscription = subscribeToNotifications("u-1", callback, onError);

    // 1st read fails: the bell shows the error.
    fake.reads[0]({ data: null, error: new Error("offline") });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    // "Try again" (read 2) and, before it comes back, a new notice (read 3).
    void subscription.reload();
    fake.onChange();
    expect(fake.reads).toHaveLength(3);

    // Read 3 comes back first, with the new notice; read 2 comes back later, stale.
    fake.reads[2]({ data: [row("new"), row("old")], error: null });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    fake.reads[1]({ data: [row("old")], error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].map((item: { id: string }) => item.id)).toEqual(["new", "old"]);
    expect(onError).toHaveBeenCalledOnce();
    // The re-read does not touch the channel.
    expect(fake.removeChannel).not.toHaveBeenCalled();

    // Once turned off, a read that still comes back delivers nothing.
    fake.onChange();
    subscription();
    fake.reads[3]({ data: [], error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledOnce();
    expect(fake.removeChannel).toHaveBeenCalledOnce();
  });
});

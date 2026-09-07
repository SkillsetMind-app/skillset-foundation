import { describe, expect, it, vi } from "vitest";

import { subscribeToCommunityReports } from "./community-posts";
import { subscribeToAdminSupportTickets } from "./support-tickets";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => mocks.client }));

type QueryResult = { data: Record<string, unknown>[] | null; error: Error | null };

function deferredRead() {
  let resolve!: (result: QueryResult) => void;
  const promise = new Promise<QueryResult>((done) => { resolve = done; });
  return { promise, resolve };
}

function queueClient() {
  let notify = () => {};
  const read = vi.fn<() => Promise<QueryResult>>();
  const channel = {
    on(_event: string, _filter: unknown, callback: () => void) { notify = callback; return channel; },
    subscribe() { return channel; },
  };
  const removeChannel = vi.fn();
  mocks.client = {
    from: () => ({ select: read }),
    channel: () => channel,
    removeChannel,
  };
  return { read, channel, removeChannel, notify: () => notify() };
}

const queues = [
  {
    name: "support tickets",
    subscribe: subscribeToAdminSupportTickets,
    row: { id: "ticket-test", subject: "Test ticket", status: "open" },
  },
  {
    name: "community reports",
    subscribe: subscribeToCommunityReports,
    row: { id: "report-test", created_at: "2026-09-06T10:00:00Z", status: "open" },
  },
] as const;

describe.each(queues)("$name refresh ordering", ({ subscribe, row }) => {
  it.each([
    ["success", "success"],
    ["success", "error"],
    ["error", "success"],
    ["error", "error"],
  ] as const)("keeps the latest %s after an older %s arrives", async (latestOutcome, olderOutcome) => {
    const client = queueClient();
    const older = deferredRead();
    const latest = deferredRead();
    client.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribe(next, onError);

    client.notify();
    const latestError = new Error("Latest read failed");
    latest.resolve(latestOutcome === "success"
      ? { data: [{ ...row, status: "resolved" }], error: null }
      : { data: null, error: latestError });
    await latest.promise;

    older.resolve(olderOutcome === "success"
      ? { data: [{ ...row }], error: null }
      : { data: null, error: new Error("Older read failed") });
    await older.promise;

    if (latestOutcome === "success") {
      expect(next).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ id: row.id, status: "resolved" })]);
      expect(onError).not.toHaveBeenCalled();
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledExactlyOnceWith(latestError);
    }
    stop();
  });

  it.each(["success", "error"])("ignores a pending %s and stops refreshes after cleanup", async (outcome) => {
    const client = queueClient();
    const pending = deferredRead();
    client.read.mockReturnValue(pending.promise);
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribe(next, onError);

    stop();
    client.notify();
    pending.resolve(outcome === "success"
      ? { data: [{ ...row }], error: null }
      : { data: null, error: new Error("Read finished after cleanup") });
    await pending.promise;

    expect(next).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledExactlyOnceWith(client.channel);
  });

  it("delivers a current failure and recovers on the next notification", async () => {
    const client = queueClient();
    const failed = deferredRead();
    const recovered = deferredRead();
    client.read.mockReturnValueOnce(failed.promise).mockReturnValueOnce(recovered.promise);
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribe(next, onError);
    const error = new Error("Current read failed");
    failed.resolve({ data: null, error });
    await failed.promise;
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(next).not.toHaveBeenCalled();

    client.notify();
    recovered.resolve({ data: [], error: null });
    await recovered.promise;
    expect(next).toHaveBeenCalledExactlyOnceWith([]);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });
});

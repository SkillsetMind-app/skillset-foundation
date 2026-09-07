import { describe, expect, it, vi } from "vitest";

import { subscribeToVerificationQueue } from "./creator-verification";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => mocks.client }));

type QueryResult = { data: Record<string, unknown>[] | null; error: Error | null };
const pendingRow = {
  id: "case-test", creator_id: "creator-test", status: "pending", profession: "Coach",
  registration_type: "Training", registration_id: "test", registration_region: "US",
  evidence_links: [], note: null, review_note: null, reviewed_by: null, reviewed_at: null,
  created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
};

function deferredRead() {
  let resolve!: (value: QueryResult) => void;
  const promise = new Promise<QueryResult>((done) => { resolve = done; });
  return { promise, resolve };
}

function controlledQueueClient() {
  let notify = () => {};
  const readQueue = vi.fn().mockResolvedValue({ data: [pendingRow], error: null });
  const readApplicants = vi.fn().mockResolvedValue({ data: [], error: null });
  const removeChannel = vi.fn();
  const channel = {
    on(_event: string, _filter: unknown, callback: () => void) { notify = callback; return channel; },
    subscribe() { return channel; },
  };
  mocks.client = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order: readQueue,
        in: readApplicants,
      };
    },
    channel: () => channel,
    removeChannel,
  };
  return { readQueue, readApplicants, removeChannel, notify: () => notify() };
}

describe("creator verification queue refresh", () => {
  it("removes a reviewed case when its status leaves pending and cleans up the channel", async () => {
    let status = "pending";
    let onChange = () => {};
    let realtimeFilter: string | undefined;
    const removeChannel = vi.fn();
    const queueRows = () => status === "pending" ? [{
      id: "case-test", creator_id: "creator-test", status, profession: "Coach",
      registration_type: "Training", registration_id: "test", registration_region: "US",
      evidence_links: [], note: null, review_note: null, reviewed_by: null, reviewed_at: null,
      created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
    }] : [];
    const channel = {
      on(_event: string, filter: { filter?: string }, callback: () => void) {
        realtimeFilter = filter.filter; onChange = callback; return channel;
      },
      subscribe() { return channel; },
    };
    mocks.client = {
      from(table: string) {
        return {
          select() { return this; },
          eq(column: string, value: string) { expect([column, value]).toEqual(["status", "pending"]); return this; },
          order() { return Promise.resolve({ data: queueRows(), error: null }); },
          in() { expect(table).toBe("users"); return Promise.resolve({ data: [{ uid: "creator-test", display_name: "Creator", email: "creator@example.test" }], error: null }); },
        };
      },
      channel: () => channel,
      removeChannel,
    };
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToVerificationQueue(next, onError);
    await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith([expect.objectContaining({ id: "case-test" })]));

    // Realtime applies the filter to the new row. An UPDATE to approved does
    // not reach a status=pending listener, so only an unfiltered observer sees it.
    status = "approved";
    if (!realtimeFilter || realtimeFilter === `status=eq.${status}`) onChange();
    await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith([]));
    expect(onError).not.toHaveBeenCalled();
    stop();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it.each(["success", "error"])("ignores a stale applicant lookup %s after a newer approval removed the case", async (outcome) => {
    const client = controlledQueueClient();
    const previousLookup = deferredRead();
    client.readApplicants.mockReturnValueOnce(previousLookup.promise);
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToVerificationQueue(next, onError);
    await vi.waitFor(() => expect(client.readApplicants).toHaveBeenCalledTimes(1));

    client.readQueue.mockResolvedValue({ data: [], error: null });
    client.notify();
    await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith([]));
    previousLookup.resolve(outcome === "success"
      ? { data: [{ uid: "creator-test", display_name: "Creator" }], error: null }
      : { data: null, error: new Error("Older lookup failed") });
    await previousLookup.promise;
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenLastCalledWith([]);
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it("ignores a stale queue read error after a newer successful refresh", async () => {
    const client = controlledQueueClient();
    const previousRead = deferredRead();
    client.readQueue.mockReturnValueOnce(previousRead.promise).mockResolvedValue({ data: [], error: null });
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToVerificationQueue(next, onError);
    client.notify();
    await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith([]));
    previousRead.resolve({ data: null, error: new Error("Older read failed") });
    await previousRead.promise;
    expect(next).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it.each(["queue", "applicants"])("ignores callbacks after cleanup while waiting for %s", async (phase) => {
    const client = controlledQueueClient();
    const pendingRead = deferredRead();
    if (phase === "queue") client.readQueue.mockReturnValueOnce(pendingRead.promise);
    else client.readApplicants.mockReturnValueOnce(pendingRead.promise);
    const next = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToVerificationQueue(next, onError);
    if (phase === "applicants") await vi.waitFor(() => expect(client.readApplicants).toHaveBeenCalledTimes(1));
    stop();
    pendingRead.resolve(phase === "queue"
      ? { data: [], error: null }
      : { data: null, error: new Error("Lookup after cleanup") });
    await pendingRead.promise;
    expect(next).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});

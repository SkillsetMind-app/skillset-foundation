import { describe, expect, it, vi } from "vitest";

import { subscribeToUserSupportTickets } from "./support-tickets";

const mocks = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return {
      from: () => ({ select: () => ({ eq: async () => ({ data: mocks.rows, error: null }) }) }),
      channel: () => channel,
      removeChannel: vi.fn(),
    };
  },
}));

describe("a person's own support tickets", () => {
  it("lists the latest activity first, falling back to the creation date", async () => {
    mocks.rows = [
      { id: "old", subject: "A", status: "resolved", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z" },
      { id: "answered", subject: "Z", status: "resolved", created_at: "2026-09-03T10:00:00Z", updated_at: "2026-09-14T10:00:00Z" },
      { id: "never-updated", subject: "B", status: "open", created_at: "2026-09-12T10:00:00Z", updated_at: null },
      { id: "new", subject: "M", status: "open", created_at: "2026-09-10T10:00:00Z", updated_at: "2026-09-10T10:00:00Z" },
    ];
    const next = vi.fn();
    const stop = subscribeToUserSupportTickets("learner-test", next, vi.fn());

    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(next.mock.calls[0][0].map((ticket: { id: string }) => ticket.id))
      .toEqual(["answered", "never-updated", "new", "old"]);
    stop();
  });
});

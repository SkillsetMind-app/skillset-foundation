import { describe, expect, it, vi } from "vitest";

// Two screens open at the same time subscribe to the same row: the status
// notice and the account menu on `users:<uid>`, the bell and the learner
// dashboard on `notifications:user:<uid>`, the course overview and the recent
// activity on `orders:teacher:<uid>`. realtime-js returns the channel that
// ALREADY EXISTS when the name repeats, drops the second identical filter, and
// removeChannel closes the channel for everyone: the screen that came in later
// never heard anything, and when one of them left, the other went deaf. The
// browser client (client.ts) puts a unique suffix on each channel; this test
// runs the real client through a fake realtime that behaves like the real one
// and proves that both screens listen.

type Binding = { table: string; filter: string; handler: (payload: unknown) => void };
type FakeChannel = { name: string; joined: boolean; bindings: Binding[] };

const fake = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const rows: Record<string, unknown[]> = {};

  // Chainable query that answers with the table's rows.
  function query(table: string) {
    let single = false;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      maybeSingle: () => {
        single = true;
        return builder;
      },
      then: (resolve: (answer: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: single ? rows[table]?.[0] ?? null : rows[table] ?? [], error: null }).then(resolve),
    };
    return builder;
  }

  // Like realtime-js: a repeated name returns the same channel; the second
  // identical filter is dropped; subscribe only acts on a closed channel;
  // removeChannel closes it for everyone who holds that channel.
  function channel(name: string) {
    const existing = channels.find((item) => item.name === name);
    if (existing) return api(existing);
    const created: FakeChannel = { name, joined: false, bindings: [] };
    channels.push(created);
    return api(created);
  }

  function api(state: FakeChannel) {
    const handle = {
      state,
      on: (_kind: string, filter: { table: string; filter: string }, handler: (payload: unknown) => void) => {
        const duplicate = state.bindings.some(
          (binding) => binding.table === filter.table && binding.filter === filter.filter,
        );
        if (!duplicate) state.bindings.push({ table: filter.table, filter: filter.filter, handler });
        return handle;
      },
      subscribe: () => {
        state.joined = true;
        return handle;
      },
    };
    return handle;
  }

  function removeChannel(handle: { state: FakeChannel }) {
    handle.state.joined = false;
    handle.state.bindings = [];
    channels.splice(channels.indexOf(handle.state), 1);
    return Promise.resolve("ok");
  }

  // A change in the database: every open channel with a filter on that table hears it.
  function emit(table: string, filter: string, payload: unknown = {}) {
    for (const item of channels) {
      if (!item.joined) continue;
      for (const binding of item.bindings) {
        if (binding.table === table && binding.filter === filter) binding.handler(payload);
      }
    }
  }

  const base = { from: query, channel, removeChannel };
  return { base, rawChannel: channel, rows, emit };
});

vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => fake.base }));
vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({ url: "https://project.example.test", anonKey: "publishable-test-key" }),
}));

const { subscribeToUserProfile } = await import("@/lib/data/user-profiles");
const { subscribeToNotifications } = await import("@/lib/data/notifications");
const { subscribeToTeacherOrders } = await import("@/lib/data/orders");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the fake realtime behaves like the real one", () => {
  // Without this the rest proves nothing: with the same name, the second screen goes deaf.
  it("without the suffix, the second subscription with the same name never hears anything", () => {
    const first = vi.fn();
    const second = vi.fn();
    fake.rawChannel("raw:same").on("postgres_changes", { table: "t", filter: "id=eq.1" }, first).subscribe();
    fake.rawChannel("raw:same").on("postgres_changes", { table: "t", filter: "id=eq.1" }, second).subscribe();
    fake.emit("t", "id=eq.1");
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});

describe("two screens on the same row both listen, and one leaving does not silence the other", () => {
  it("users:<uid> (status notice + account menu)", async () => {
    fake.rows.users = [{ uid: "u-1", display_name: "Ana" }];
    const banner = vi.fn();
    const menu = vi.fn();
    const stopBanner = subscribeToUserProfile("u-1", banner, vi.fn());
    const stopMenu = subscribeToUserProfile("u-1", menu, vi.fn());
    await settle();
    banner.mockClear();
    menu.mockClear();

    fake.emit("users", "uid=eq.u-1", { eventType: "UPDATE", new: { uid: "u-1", display_name: "Ana B" } });
    expect(banner).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Ana B" }));
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Ana B" }));

    stopBanner();
    fake.emit("users", "uid=eq.u-1", { eventType: "UPDATE", new: { uid: "u-1", display_name: "Ana C" } });
    expect(menu).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: "Ana C" }));
    expect(banner).toHaveBeenCalledOnce();
    stopMenu();
  });

  it("notifications:user:<uid> (bell + learner dashboard)", async () => {
    fake.rows.notifications = [];
    const bell = vi.fn();
    const dashboard = vi.fn();
    const stopBell = subscribeToNotifications("u-1", bell, vi.fn());
    const stopDashboard = subscribeToNotifications("u-1", dashboard, vi.fn());
    await settle();
    expect(bell).toHaveBeenCalledWith([]);
    expect(dashboard).toHaveBeenCalledWith([]);

    fake.rows.notifications = [
      { notification_id: "n-1", type: "support_reply", title: "", body: "", read: false, link: null, actor_name: null, params: null, created_at: "2026-11-22T10:00:00.000Z" },
    ];
    fake.emit("notifications", "user_id=eq.u-1");
    await settle();
    expect(bell).toHaveBeenLastCalledWith([expect.objectContaining({ id: "n-1" })]);
    expect(dashboard).toHaveBeenLastCalledWith([expect.objectContaining({ id: "n-1" })]);

    stopDashboard();
    fake.rows.notifications = [];
    fake.emit("notifications", "user_id=eq.u-1");
    await settle();
    expect(bell).toHaveBeenLastCalledWith([]);
    stopBell();
  });

  it("orders:teacher:<uid> (course overview + recent activity)", async () => {
    fake.rows.orders = [];
    const overview = vi.fn();
    const activity = vi.fn();
    const stopOverview = subscribeToTeacherOrders("t-1", overview, vi.fn());
    const stopActivity = subscribeToTeacherOrders("t-1", activity, vi.fn());
    await settle();
    overview.mockClear();
    activity.mockClear();

    fake.rows.orders = [
      { id: "o-1", status: "paid", amount_minor: 100, currency: "USD", teacher_id: "t-1", user_id: "s-1", course_id: "c-1", created_at: "2026-11-22T10:00:00.000Z", updated_at: "2026-11-22T10:00:00.000Z" },
    ];
    fake.emit("orders", "teacher_id=eq.t-1");
    await settle();
    expect(overview).toHaveBeenCalledWith([expect.objectContaining({ id: "o-1" })]);
    expect(activity).toHaveBeenCalledWith([expect.objectContaining({ id: "o-1" })]);

    stopOverview();
    activity.mockClear();
    fake.emit("orders", "teacher_id=eq.t-1");
    await settle();
    expect(activity).toHaveBeenCalledOnce();
    stopActivity();
  });
});

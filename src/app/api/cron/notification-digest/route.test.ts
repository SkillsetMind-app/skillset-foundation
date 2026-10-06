import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getUserById: vi.fn(),
  fetch: vi.fn(),
  sleep: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("node:timers/promises", () => ({ default: { setTimeout: mocks.sleep }, setTimeout: mocks.sleep }));

// The real Resend sender runs: only the network (fetch) is faked, so these
// cases prove what the provider actually got.
import { GET } from "@/app/api/cron/notification-digest/route";

const CRON_TOKEN = "test-cron-token";
const APP = "https://app.example.test";
const NOW = Date.parse("2026-10-06T12:07:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

type Row = { notification_id: string; user_id: string; created_at: string; read: boolean; emailed_at: string | null };
let waiting: Row[];
let recent: Row[];
let profiles: { uid: string; preferences: unknown }[];
let accounts: Record<string, { id: string; email?: string; email_confirmed_at?: string | null; user_metadata: Record<string, unknown> }>;
let marked: { values: unknown; ids: string[] }[];

// Supabase query builder stand-in: every method chains, awaiting answers by
// table and by the filters the route used.
function query(table: string) {
  const calls: [string, ...unknown[]][] = [];
  const answer = () => {
    const [first] = calls;
    if (table === "users") return { data: profiles, error: null };
    if (first?.[0] === "update") {
      marked.push({ values: first[1], ids: calls.find((call) => call[0] === "in")?.[2] as string[] });
      return { error: null };
    }
    const byEmail = calls.some((call) => call[0] === "gte" && call[1] === "emailed_at");
    return { data: byEmail ? recent : waiting, error: null };
  };
  const builder: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void) => resolve(answer());
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return builder;
      };
    },
  });
  return builder;
}

function account(id: string, extra: Partial<(typeof accounts)[string]> = {}) {
  accounts[id] = { id, email: `${id}@example.test`, email_confirmed_at: minutesAgo(9000), user_metadata: {}, ...extra };
}
function notification(id: string, userId: string, ageMinutes: number): Row {
  return { notification_id: id, user_id: userId, created_at: minutesAgo(ageMinutes), read: false, emailed_at: null };
}

function call(header?: string) {
  return GET(new Request("http://localhost/api/cron/notification-digest", {
    headers: header ? { authorization: header } : {},
  }));
}
const run = () => call(`Bearer ${CRON_TOKEN}`);
const sentBodies = () => mocks.fetch.mock.calls.map((args) => JSON.parse(args[1].body as string));
const sentHeaders = () => mocks.fetch.mock.calls.map((args) => args[1].headers as Record<string, string>);

describe("notification digest cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    vi.stubEnv("SKILLSET_APP_URL", APP);
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockImplementation(async () => new Response("{}"));
    waiting = [];
    recent = [];
    profiles = [];
    accounts = {};
    marked = [];
    mocks.getUserById.mockImplementation(async (id: string) => ({ data: { user: accounts[id] ?? null }, error: null }));
    mocks.getAdmin.mockReturnValue({ from: query, auth: { admin: { getUserById: mocks.getUserById } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses a call without the cron secret", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("emails each person once with the count, in their language, after marking the rows", async () => {
    account("ana", { user_metadata: { locale: "es" } });
    account("bia");
    waiting = [notification("n1", "ana", 40), notification("n2", "ana", 20), notification("n3", "bia", 30)];

    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, due: 2, sent: 2, skipped: 0, failed: 0 });

    const [toAna, toBia] = sentBodies();
    expect(toAna.to).toEqual(["ana@example.test"]);
    expect(toAna.subject).toBe("Tienes 2 notificaciones nuevas");
    expect(toAna.html).toContain(`href="${APP}/account/notifications"`);
    expect(toAna.text).toContain(`${APP}/account?tab=notifications`);
    expect(toBia.subject).toBe("You have 1 new notification");
    expect(toBia.html).toContain("Email summary");

    expect(marked).toEqual([
      { values: { emailed_at: new Date(NOW).toISOString() }, ids: ["n1", "n2"] },
      { values: { emailed_at: new Date(NOW).toISOString() }, ids: ["n3"] },
    ]);
    // One key per person per hour: a repeated call in the same hour sends nothing new.
    expect(sentHeaders()[0]["Idempotency-Key"]).toBe(`notification-digest:ana:${Math.floor(NOW / 3_600_000)}`);
  });

  it("skips whoever turned the summary off, got one this hour, or cannot get email", async () => {
    account("off");
    account("recent");
    account("unconfirmed", { email_confirmed_at: null });
    account("ok");
    profiles = [{ uid: "off", preferences: { notifications: { emailDigest: false } } }];
    waiting = [
      notification("n1", "off", 30),
      notification("n2", "recent", 30),
      notification("n3", "unconfirmed", 30),
      notification("n4", "ok", 30),
    ];
    recent = [{ ...notification("old", "recent", 120), emailed_at: minutesAgo(30) }];

    const response = await run();
    expect(await response.json()).toMatchObject({ ok: true, due: 2, sent: 1, skipped: 1 });
    expect(sentBodies().map((body) => body.to[0])).toEqual(["ok@example.test"]);
    expect(marked.map((mark) => mark.ids)).toEqual([["n4"]]);
  });

  it("does nothing when no notification is waiting", async () => {
    const response = await run();
    expect(await response.json()).toMatchObject({ ok: true, due: 0, sent: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("stops the run on a provider failure, after marking that person's rows", async () => {
    account("ana");
    account("bia");
    waiting = [notification("n1", "ana", 40), notification("n2", "bia", 30)];
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: 503 }));

    const response = await run();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, sent: 0, failed: 1 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(marked.map((mark) => mark.ids)).toEqual([["n1"]]);
  });
});

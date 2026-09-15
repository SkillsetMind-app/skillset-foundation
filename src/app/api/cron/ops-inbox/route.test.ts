import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));

// The real sender runs: only the network (fetch) is faked, so these cases prove
// what the relay actually got — not what a mocked notifier claims.
import { GET } from "@/app/api/cron/ops-inbox/route";

const CRON_TOKEN = "test-cron-token";
const RELAY = "https://relay.example.test/hook";
// 08:07 UTC: an ordinary hourly run, not the daily reminder.
const NOW = Date.parse("2026-09-15T08:07:00Z");
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

// Every column a real row carries, personal data included: the fake returns
// all of it no matter what was selected, so the privacy case proves the route
// never forwards it, not merely that it asked for less.
const PERSONAL = [
  "ana@example.test", "Ana Rivera", "Refund for Alpha course", "My card was charged twice",
  "bruno@example.test", "Bruno Reporter", "Spam links in the thread", "Carla Target",
  "Nurse practitioner", "RN-998877", "Please check my license",
];
const ticket = (hours: number, id = "11111111-1111-4111-8111-111111111111") => ({
  id, status: "open", created_at: ago(hours), updated_at: ago(hours),
  user_email: PERSONAL[0], user_name: PERSONAL[1], subject: PERSONAL[2], message: PERSONAL[3],
});
const report = (hours: number, id = "22222222-2222-4222-8222-222222222222") => ({
  id, status: "open", created_at: ago(hours), updated_at: ago(hours),
  reporter_email: PERSONAL[4], reporter_name: PERSONAL[5], detail: PERSONAL[6], target_author_name: PERSONAL[7],
});
const verification = (createdHours: number, updatedHours: number, id = "33333333-3333-4333-8333-333333333333") => ({
  id, status: "pending", created_at: ago(createdHours), updated_at: ago(updatedHours),
  profession: PERSONAL[8], registration_id: PERSONAL[9], note: PERSONAL[10],
});

type Result = { data: unknown[] | null; error: { message: string } | null };
let tables: Record<string, Result>;
function rows(next: { tickets?: unknown[]; reports?: unknown[]; verifications?: unknown[] }) {
  tables = {
    support_tickets: { data: next.tickets ?? [], error: null },
    community_reports: { data: next.reports ?? [], error: null },
    creator_verification_cases: { data: next.verifications ?? [], error: null },
  };
}

function call(authorization?: string) {
  return GET(
    new Request("http://localhost/api/cron/ops-inbox", {
      headers: authorization ? { authorization } : {},
    }),
  );
}
const authed = () => call(`Bearer ${CRON_TOKEN}`);
const sentBody = () => JSON.parse(mocks.fetch.mock.calls[0][1].body as string);

describe("ops inbox cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    vi.stubEnv("OPS_ALERT_WEBHOOK_URL", RELAY);
    vi.stubEnv("OPS_ALERT_WEBHOOK_SECRET", "");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(new Response("ok"));
    mocks.getAdmin.mockReturnValue({ from: mocks.from });
    mocks.from.mockImplementation((table: string) => ({
      select: (columns: string) => {
        mocks.select(table, columns);
        return {
          in: (column: string, values: string[]) => {
            mocks.in(table, column, values);
            return Promise.resolve(tables[table]);
          },
        };
      },
    }));
    rows({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["missing header", undefined],
    ["wrong value", `Bearer not-${CRON_TOKEN}`],
  ])("refuses a %s without reading the database", async (_label, header) => {
    const response = await call(header);

    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stays silent when every queue is empty", async () => {
    const response = await authed();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, open: { tickets: 0, reports: 0, verifications: 0 }, alerted: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reads only ids and timestamps of the items that still need staff", async () => {
    await authed();

    expect(mocks.select.mock.calls).toEqual([
      ["support_tickets", "id, created_at"],
      ["community_reports", "id, created_at"],
      ["creator_verification_cases", "id, updated_at"],
    ]);
    expect(mocks.in.mock.calls).toEqual([
      ["support_tickets", "status", ["open", "in_review"]],
      ["community_reports", "status", ["open"]],
      ["creator_verification_cases", "status", ["pending"]],
    ]);
  });

  it("sends exactly one alert for a fresh ticket, with no personal data in it", async () => {
    rows({ tickets: [ticket(0.5), ticket(5, "44444444-4444-4444-8444-444444444444")], reports: [report(30)] });

    const response = await authed();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, alerted: true, oldest_hours: 30 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe(RELAY);
    expect(mocks.fetch.mock.calls[0][1].method).toBe("POST");
    const raw = mocks.fetch.mock.calls[0][1].body as string;
    for (const value of PERSONAL) {
      expect(raw).not.toContain(value);
    }
    expect(sentBody()).toMatchObject({
      event: "ops.inbox.new",
      severity: "warn",
      summary: "1 new support ticket(s), 0 report(s), 0 verification(s) waiting. Oldest open: 30 h. Open /ops.",
      context: {
        reason: "new", oldest_hours: 30, tickets_new: 1, tickets_open: 2, reports_open: 1,
        ticket_ids: "11111111-1111-4111-8111-111111111111,44444444-4444-4444-8444-444444444444",
      },
    });
  });

  it("never sends more than 5 ids per kind, and drops ids that are not uuids", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ticket(0.5 + i / 10, `5555555${i}-5555-4555-8555-555555555555`));
    rows({ tickets: [...many, ticket(0.1, "ana@example.test")] });

    await authed();

    const ids = sentBody().context.ticket_ids.split(",");
    expect(ids).toHaveLength(5);
    expect(ids.every((id: string) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });

  it("does not alert every hour for items already reported, but reminds at 12:00 UTC", async () => {
    rows({ tickets: [ticket(5)], verifications: [verification(30, 30)] });

    const quiet = await authed();
    expect(quiet.status).toBe(200);
    expect(await quiet.json()).toMatchObject({ ok: true, alerted: false, oldest_hours: 30 });
    expect(mocks.fetch).not.toHaveBeenCalled();

    vi.setSystemTime(Date.parse("2026-09-15T12:07:00Z"));
    rows({ tickets: [ticket(5)], verifications: [verification(30, 30)] });
    const daily = await authed();

    expect(daily.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().context).toMatchObject({ reason: "daily", tickets_open: 1, verifications_open: 1 });
    expect(sentBody().summary).toBe(
      "Still open: 1 support ticket(s), 0 report(s), 1 verification(s) waiting. Oldest open: 30 h. Open /ops.",
    );
  });

  it("counts a resubmitted verification as new (old created_at, fresh updated_at)", async () => {
    rows({ verifications: [verification(72, 0.5)] });

    const response = await authed();

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().context).toMatchObject({ reason: "new", verifications_new: 1 });
  });

  it("turns the run red when there is something new and no alert channel", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPS_ALERT_WEBHOOK_URL", "");
    rows({ reports: [report(0.5)] });

    const response = await authed();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, reason: "alert_channel_missing", alerted: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("turns the run red when the relay answers 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetch.mockResolvedValue(new Response("down", { status: 500 }));
    rows({ tickets: [ticket(0.5)] });

    const response = await authed();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, reason: "alert_not_delivered", alerted: false });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
  });

  it("turns the run red when a table cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rows({ tickets: [ticket(0.5)] });
    tables.community_reports = { data: null, error: { message: "connection lost" } };

    const response = await authed();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "read_failed" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});

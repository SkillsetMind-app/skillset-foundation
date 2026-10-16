import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  rpc: vi.fn(),
  fetch: vi.fn(),
  sleep: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("node:timers/promises", () => ({ default: { setTimeout: mocks.sleep }, setTimeout: mocks.sleep }));

// The real Resend sender runs: only the network (fetch) and the claim RPC are
// faked. Who is due, who is skipped and the marking live in SQL
// (claim_notification_digests), proven by the smoke test in supabase/tests.
import { GET } from "@/app/api/cron/notification-digest/route";

const CRON_TOKEN = "test-cron-token";
const APP = "https://app.example.test";
const NOW = Date.parse("2026-10-06T12:07:00Z");

type Claim = {
  user_id: string;
  email: string;
  locale: string | null;
  notification_ids: string[];
  notification_count: number;
};
// Each RPC call takes the next answer; an empty queue means nobody is due.
let claims: { data: Claim[] | null; error: { code: string } | null }[];

function claim(userId: string, count: number, locale: string | null = null) {
  const ids = Array.from({ length: count }, (_, index) => `${userId}-n${index}`);
  return {
    data: [{ user_id: userId, email: `${userId}@example.test`, locale, notification_ids: ids, notification_count: count }],
    error: null,
  };
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
    claims = [];
    mocks.rpc.mockImplementation(async () => claims.shift() ?? { data: [], error: null });
    mocks.getAdmin.mockReturnValue({ rpc: mocks.rpc });
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

  it("claims one person at a time and emails the count in their language", async () => {
    claims = [claim("ana", 2, "es"), claim("bia", 1)];

    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sent: 2, failed: 0 });

    // One person per claim, until the claim comes back empty.
    expect(mocks.rpc.mock.calls).toEqual([
      ["claim_notification_digests", { p_limit: 1 }],
      ["claim_notification_digests", { p_limit: 1 }],
      ["claim_notification_digests", { p_limit: 1 }],
    ]);

    const [toAna, toBia] = sentBodies();
    expect(toAna.to).toEqual(["ana@example.test"]);
    expect(toAna.subject).toBe("Tienes 2 notificaciones nuevas");
    expect(toAna.html).toContain(`href="${APP}/account/notifications"`);
    expect(toAna.text).toContain(`${APP}/account?tab=notifications`);
    expect(toBia.subject).toBe("You have 1 new notification");
    expect(toBia.html).toContain("Email summary");
    // One key per person per hour: a repeated call in the same hour sends nothing new.
    expect(sentHeaders()[0]["Idempotency-Key"]).toBe(`notification-digest:ana:${Math.floor(NOW / 3_600_000)}`);
  });

  it("does nothing when nobody is due", async () => {
    const response = await run();
    expect(await response.json()).toEqual({ ok: true, sent: 0, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stops at 25 emails a run without claiming a 26th person", async () => {
    claims = Array.from({ length: 30 }, (_, index) => claim(`p${index}`, 1));

    const response = await run();
    expect(await response.json()).toEqual({ ok: true, sent: 25, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(25);
    expect(mocks.fetch).toHaveBeenCalledTimes(25);
  });

  it("stops the run on a provider failure, so an outage costs one claimed email", async () => {
    claims = [claim("ana", 1), claim("bia", 1)];
    mocks.fetch.mockImplementation(async () => new Response("{}", { status: 503 }));

    const response = await run();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, sent: 0, failed: 1 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("answers 500 and sends nothing when the claim fails", async () => {
    claims = [{ data: null, error: { code: "42501" } }];

    const response = await run();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, sent: 0, failed: 1 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

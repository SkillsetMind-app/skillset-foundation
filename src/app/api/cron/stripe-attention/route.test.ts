import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));

// The real sender runs: only the network (fetch) is faked, so these cases prove
// what the relay actually got — not what a mocked notifier claims.
import { GET } from "@/app/api/cron/stripe-attention/route";

const CRON_TOKEN = "test-cron-token";
const RELAY = "https://relay.example.test/hook";
// 08:07 UTC: an ordinary hourly run, not the daily reminder.
const NOW = Date.parse("2026-09-15T08:07:00Z");

function stuckFor(...hours: number[]) {
  mocks.select.mockResolvedValue({
    data: hours.map((h) => ({ claimed_at: new Date(Date.now() - h * 3_600_000).toISOString() })),
    error: null,
  });
}

function call(authorization?: string) {
  return GET(
    new Request("http://localhost/api/cron/stripe-attention", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

function sentBody(index = 0) {
  return JSON.parse(mocks.fetch.mock.calls[index][1].body as string);
}

describe("stripe attention cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    vi.stubEnv("OPS_ALERT_WEBHOOK_URL", RELAY);
    vi.stubEnv("OPS_ALERT_WEBHOOK_SECRET", "");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(new Response("ok"));
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.getAdmin.mockReturnValue({ from: mocks.from });
    stuckFor();
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
    ["same-length wrong value", `Bearer ${"x".repeat(CRON_TOKEN.length)}`],
  ])("refuses a %s without reading the database", async (_label, header) => {
    const response = await call(header);

    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stays closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await call("Bearer ");

    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("stays silent when nothing is stuck", async () => {
    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 0, alerted: false });
    expect(mocks.from).toHaveBeenCalledWith("stripe_events_needing_attention");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("delivers exactly one alert with the count when an event just got stuck", async () => {
    stuckFor(30, 5, 0.5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 3, oldest_hours: 30, alerted: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe(RELAY);
    expect(sentBody()).toMatchObject({
      event: "stripe.events.needing_attention",
      severity: "critical",
      context: { count: 3, oldest_hours: 30, reason: "new" },
    });
    // Only the claim time is read: nothing that identifies a buyer can reach the alert.
    expect(mocks.select).toHaveBeenCalledWith("claimed_at");
  });

  it("does not repeat the alert every hour for events already reported", async () => {
    stuckFor(30, 5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 2, oldest_hours: 30, alerted: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reminds once a day while something is still stuck", async () => {
    vi.setSystemTime(Date.parse("2026-09-15T12:07:00Z"));
    stuckFor(30, 5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 2, alerted: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().context).toEqual({ count: 2, oldest_hours: 30, reason: "daily" });
  });

  // A stuck buyer that nobody hears about is the exact failure this route
  // exists to catch, so every "nobody was told" case must turn the run red.
  it.each([
    ["the relay is unreachable", () => mocks.fetch.mockRejectedValue(new Error("relay down"))],
    ["the relay refuses the alert", () => mocks.fetch.mockResolvedValue(new Response("no", { status: 403 }))],
  ])("turns the run red when %s", async (_label, arrange) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();
    stuckFor(0.5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false, reason: "alert_not_delivered", count: 1, oldest_hours: 0, alerted: false,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
  });

  it("turns the run red when no alert channel is configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPS_ALERT_WEBHOOK_URL", "");
    stuckFor(0.5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, reason: "alert_channel_missing", alerted: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("turns the run red when the view cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.select.mockResolvedValue({ data: null, error: { message: "connection lost" } });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "read_failed" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("answers JSON when the service-role client is missing", async () => {
    mocks.getAdmin.mockImplementation(() => {
      throw new Error("not configured");
    });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "service_role_missing" });
  });
});

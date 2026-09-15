import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notify }));

import { GET } from "@/app/api/cron/stripe-attention/route";

const CRON_TOKEN = "test-cron-token";
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

describe("stripe attention cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.getAdmin.mockReturnValue({ from: mocks.from });
    stuckFor();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    expect(mocks.notify).not.toHaveBeenCalled();
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
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("sends exactly one alert with the count when an event just got stuck", async () => {
    stuckFor(30, 5, 0.5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 3, oldest_hours: 30, alerted: true });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      event: "stripe.events.needing_attention",
      severity: "critical",
      context: { count: 3, oldest_hours: 30, reason: "new" },
    }));
    // Only the claim time is read: nothing that identifies a buyer can reach the alert.
    expect(mocks.select).toHaveBeenCalledWith("claimed_at");
  });

  it("does not repeat the alert every hour for events already reported", async () => {
    stuckFor(30, 5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(await response.json()).toEqual({ ok: true, count: 2, oldest_hours: 30, alerted: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("reminds once a day while something is still stuck", async () => {
    vi.setSystemTime(Date.parse("2026-09-15T12:07:00Z"));
    stuckFor(30, 5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(await response.json()).toMatchObject({ count: 2, alerted: true });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0][0].context).toEqual({ count: 2, oldest_hours: 30, reason: "daily" });
  });

  it("still answers and logs when the alert cannot be sent", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.notify.mockImplementation(() => {
      throw new Error("relay down");
    });
    stuckFor(0.5);

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, count: 1, alerted: false });
    expect(log).toHaveBeenCalledWith("Stripe attention alert could not be sent", expect.any(Error));
  });

  it("turns the run red when the view cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.select.mockResolvedValue({ data: null, error: { message: "connection lost" } });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "read_failed" });
    expect(mocks.notify).not.toHaveBeenCalled();
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

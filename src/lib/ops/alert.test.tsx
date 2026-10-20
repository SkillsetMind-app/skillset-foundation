import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WEBHOOK = "https://relay.example.com/hook";

async function loadFresh() {
  // The throttle keeps state in module scope, so each case needs its own copy.
  vi.resetModules();
  return import("@/lib/ops/alert");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.OPS_ALERT_WEBHOOK_URL;
});

describe("notifyOps", () => {
  it("stays inert with no webhook configured", async () => {
    // Shipping this must not change how anything behaves until someone opts in.
    const { notifyOps } = await loadFresh();

    notifyOps({ event: "test.event", severity: "warn", summary: "nothing" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends once per event and throttles the repeats", async () => {
    // An attack is one incident, not nine hundred notifications. A phone that
    // buzzes nine hundred times gets silenced, which is worse than no alerting.
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    const { notifyOps } = await loadFresh();

    notifyOps({ event: "stripe.webhook.bad_signature", severity: "critical", summary: "forged" });
    notifyOps({ event: "stripe.webhook.bad_signature", severity: "critical", summary: "forged" });
    notifyOps({ event: "stripe.webhook.bad_signature", severity: "critical", summary: "forged" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);

    // A different signal is a different incident and must still get through.
    notifyOps({ event: "admin.route.denied", severity: "warn", summary: "probe" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hands the send to the platform waitUntil when after() is unavailable", async () => {
    // Outside a request scope after() throws, and a bare unawaited fetch dies
    // when a serverless instance freezes. The platform's waitUntil, read from
    // the same request context Next uses, keeps it alive until it lands.
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    const key = Symbol.for("@next/request-context");
    const slots = globalThis as unknown as Record<symbol, unknown>;
    const waitUntil = vi.fn();
    slots[key] = { get: () => ({ waitUntil }) };
    try {
      const { notifyOps } = await loadFresh();

      notifyOps({ event: "test.wait_until", severity: "warn", summary: "x" });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));

      // A broken platform context changes nothing: still no throw.
      slots[key] = { get: () => { throw new Error("context gone"); } };
      expect(() =>
        notifyOps({ event: "test.wait_until.broken", severity: "warn", summary: "x" }),
      ).not.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      delete slots[key];
    }
  });

  it("never throws when the relay fails (notifyOps)", async () => {
    // This sits on the failure path of money routes. A dead relay must not be
    // the reason a webhook handler falls over.
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    fetchMock.mockImplementation(() => Promise.reject(new Error("relay down")));
    const { notifyOps } = await loadFresh();

    expect(() =>
      notifyOps({ event: "test.event", severity: "warn", summary: "x" }),
    ).not.toThrow();
  });

  it("allows another payment failure alert after the repeat window expires", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const { notifyOps } = await loadFresh();
    const alert = { event: "payments.request.failed", severity: "critical" as const, summary: "failure" };

    notifyOps(alert);
    vi.setSystemTime(299_999);
    notifyOps(alert);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(300_000);
    notifyOps(alert);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("sendOpsAlert", () => {
  const alert = { event: "stripe.events.needing_attention", severity: "critical" as const, summary: "stuck" };

  it("reports false and sends nothing with no webhook configured", async () => {
    const { sendOpsAlert } = await loadFresh();

    await expect(sendOpsAlert(alert)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports delivery on every call, without the notifyOps throttle", async () => {
    // A cron check alerts at most a few times a day by its own rule; a throttle
    // here would turn a real alert into a silent "delivered".
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    const { sendOpsAlert } = await loadFresh();

    await expect(sendOpsAlert(alert)).resolves.toBe(true);
    await expect(sendOpsAlert(alert)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK);
  });

  it("reports false when the relay refuses or is unreachable", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    const { sendOpsAlert } = await loadFresh();

    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("no", { status: 500 })));
    await expect(sendOpsAlert(alert)).resolves.toBe(false);
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("relay down")));
    await expect(sendOpsAlert(alert)).resolves.toBe(false);
  });
});

describe("payment error fallback when alerts cannot be delivered", () => {
  it.each(["missing", "refused", "unreachable"])("preserves a safe 500 and log with relay %s", async (state) => {
    if (state !== "missing") process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    if (state === "refused") fetchMock.mockImplementation(() => Promise.resolve(new Response("no", { status: 403 })));
    if (state === "unreachable") fetchMock.mockImplementation(() => Promise.reject(new Error("relay down")));
    vi.resetModules();
    const { paymentErrorResponse } = await import("@/lib/payments/server/auth");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = paymentErrorResponse(new Error("private-buyer@example.test private-fixture"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Something went wrong. Please try again." });
      expect(log).toHaveBeenCalledExactlyOnceWith("Unhandled payment route error");
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("private-buyer");
      expect(fetchMock).toHaveBeenCalledTimes(state === "missing" ? 0 : 1);
    } finally {
      log.mockRestore();
    }
  });
});

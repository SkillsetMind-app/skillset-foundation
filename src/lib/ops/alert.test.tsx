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

  it("never throws when the relay fails", async () => {
    // This sits on the failure path of money routes. A dead relay must not be
    // the reason a webhook handler falls over.
    process.env.OPS_ALERT_WEBHOOK_URL = WEBHOOK;
    fetchMock.mockImplementation(() => Promise.reject(new Error("relay down")));
    const { notifyOps } = await loadFresh();

    expect(() =>
      notifyOps({ event: "test.event", severity: "warn", summary: "x" }),
    ).not.toThrow();
  });
});

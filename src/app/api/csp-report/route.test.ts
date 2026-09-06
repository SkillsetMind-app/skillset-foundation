import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowByIp: vi.fn(),
  allowByKey: vi.fn(),
  notifyOps: vi.fn(),
}));

vi.mock("@/lib/supabase/rate-limit", () => ({
  allowByIp: mocks.allowByIp,
  allowByKey: mocks.allowByKey,
}));

vi.mock("@/lib/ops/alert", () => ({
  notifyOps: mocks.notifyOps,
}));

import { POST } from "@/app/api/csp-report/route";

function beacon(report: Record<string, unknown>) {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({ "csp-report": report }),
  });
}

describe("csp-report: what reaches the ops channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowByIp.mockResolvedValue(true);
    mocks.allowByKey.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a blocked font but never pages anyone for it", async () => {
    const response = await POST(beacon({
      "document-uri": "https://www.skillsetmind.com/courses?ref=abc",
      "violated-directive": "font-src",
      "effective-directive": "font-src",
      "blocked-uri": "https://use.typekit.net/af/abc123/l?subset_id=2&fvd=n4&v=3",
    }));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith("[csp-report]", {
      directive: "font-src",
      blocked: "https://use.typekit.net",
      document: "/courses",
    });
    expect(mocks.notifyOps).not.toHaveBeenCalled();
    // Noise must not even touch the limiter table.
    expect(mocks.allowByKey).not.toHaveBeenCalled();
  });

  it("pages once for a blocked script, keyed by directive and origin, one hour wide", async () => {
    const response = await POST(beacon({
      "document-uri": "https://www.skillsetmind.com/learn/courses/x",
      "violated-directive": "script-src 'self' 'nonce-abc' https://js.stripe.com",
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://evil.example/payload.js?token=secret",
    }));

    expect(response.status).toBe(204);
    expect(mocks.allowByKey).toHaveBeenCalledTimes(1);
    expect(mocks.allowByKey).toHaveBeenCalledWith(
      expect.stringMatching(/^csp_alert_[a-f0-9]{24}$/),
      1,
      3_600_000,
    );
    expect(mocks.notifyOps).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOps).toHaveBeenCalledWith({
      event: "security.csp_violation",
      severity: "warn",
      summary: "The browser blocked a resource that violated the enforced CSP.",
      // The directive name alone, and the origin alone: no policy text, no query string.
      context: { directive: "script-src-elem", blocked: "https://evil.example" },
    });
  });

  it("stays quiet on the repeat within the window, and the key is stable across calls", async () => {
    const report = {
      "violated-directive": "connect-src 'self'",
      "blocked-uri": "https://exfil.example/collect",
    };
    await POST(beacon(report));
    mocks.allowByKey.mockResolvedValueOnce(false);
    await POST(beacon(report));

    expect(mocks.allowByKey).toHaveBeenCalledTimes(2);
    const [firstKey] = mocks.allowByKey.mock.calls[0] as [string];
    const [secondKey] = mocks.allowByKey.mock.calls[1] as [string];
    expect(secondKey).toBe(firstKey);
    expect(mocks.notifyOps).toHaveBeenCalledTimes(1);
  });

  it("uses the directive name when the browser only sends the full policy line", async () => {
    await POST(beacon({
      "violated-directive": "frame-src https://js.stripe.com",
      "blocked-uri": "https://phish.example/frame",
    }));

    expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
      context: { directive: "frame-src", blocked: "https://phish.example" },
    }));
  });

  it("drops the report entirely when the per-IP limiter says no", async () => {
    mocks.allowByIp.mockResolvedValueOnce(false);

    const response = await POST(beacon({
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.example/x.js",
    }));

    expect(response.status).toBe(204);
    expect(mocks.allowByKey).not.toHaveBeenCalled();
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });
});

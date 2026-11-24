import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askKimi: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/supabase/rate-limit", () => ({ rateLimitKeyFromIp: () => "assistant_ip_test" }));
vi.mock("@/lib/payments/server/auth", () => ({
  PaymentError: class PaymentError extends Error {
    status = 429;
  },
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/assistant/knowledge", () => ({ buildAssistantKnowledge: () => "PLANS-AND-FAQ" }));
// Error classes stay real: the route branches on instanceof.
vi.mock("@/lib/assistant/kimi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assistant/kimi")>()),
  askKimi: mocks.askKimi,
}));

import { POST } from "@/app/api/assistant/route";
import { KimiConfigError, KimiError } from "@/lib/assistant/kimi";

const ask = (content: string) =>
  POST(
    new Request("https://www.skillsetmind.com/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content }] }),
    }),
  );

beforeEach(() => {
  mocks.askKimi.mockReset();
  mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
});

describe("public help assistant", () => {
  it("asks kimi-k3 with the grounding context and returns the reply", async () => {
    mocks.askKimi.mockResolvedValue("Open your course and click Publish.");
    const res = await ask("How do I publish my course?");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "Open your course and click Publish." });
    const call = mocks.askKimi.mock.calls[0][0];
    expect(call.model).toBe("kimi-k3");
    expect(call.maxTokens).toBe(4096);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith("assistant_global_daily", 500, 86_400_000);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("support@skillsetmind.com");
    expect(call.messages[0].content).toContain("PLANS-AND-FAQ");
    expect(call.messages.at(-1)).toEqual({ role: "user", content: "How do I publish my course?" });
  });

  it("turns a blank model answer into a 502 without leaking the provider detail", async () => {
    mocks.askKimi.mockRejectedValue(new KimiError("empty_reply", "secret provider detail"));
    const res = await ask("hi");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("The assistant returned an empty reply. Please try again.");
    expect(JSON.stringify(body)).not.toContain("secret provider detail");
  });

  it("shows the calm set-up state when the key is missing", async () => {
    mocks.askKimi.mockRejectedValue(new KimiConfigError());
    const res = await ask("hi");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("assistant_not_configured");
  });

  it("stops at the shared daily ceiling without calling the model", async () => {
    const { PaymentError } = await import("@/lib/payments/server/auth");
    mocks.enforceRateLimit.mockImplementation(async (key: string) => {
      if (key === "assistant_global_daily") throw new PaymentError("Too many requests.");
    });
    const res = await ask("hi");
    expect(res.status).toBe(429);
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  it("does not charge the shared ceiling for a malformed request", async () => {
    const res = await POST(
      new Request("https://www.skillsetmind.com/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalledWith(
      "assistant_global_daily",
      expect.anything(),
      expect.anything(),
    );
  });

  it("reports a slow answer as a 504", async () => {
    mocks.askKimi.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const res = await ask("hi");
    expect(res.status).toBe(504);
  });
});

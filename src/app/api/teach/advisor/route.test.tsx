import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createServer: vi.fn(),
  getAdmin: vi.fn(),
  getUser: vi.fn(),
  sessionRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import { POST } from "@/app/api/teach/advisor/route";

function post() {
  return POST(new Request("http://localhost/api/teach/advisor", { method: "POST" }));
}

describe("advisor route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "teacher" } },
      error: null,
    });
    // The request-scoped client is used for exactly one thing here: the
    // is_teacher role RPC. Rate limiting goes through the service-role client.
    mocks.sessionRpc.mockResolvedValue({ data: true, error: null });
    mocks.createServer.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.sessionRpc,
    });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "RATE_LIMIT exceeded" },
    });
    mocks.getAdmin.mockReturnValue({ rpc: mocks.adminRpc });
  });

  it("authenticates, then authorizes, then rate limits with the service-role client", async () => {
    const response = await post();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Too many messages. Please wait a moment before continuing.",
    });
    expect(mocks.sessionRpc).toHaveBeenCalledWith("is_teacher");
    expect(mocks.adminRpc).toHaveBeenCalledWith("enforce_rate_limit", {
      p_key: "advisor_teacher",
      p_limit: 30,
      p_window_ms: 3_600_000,
    });
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sessionRpc.mock.invocationCallOrder[0],
    );
    expect(mocks.sessionRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAdmin.mock.invocationCallOrder[0],
    );
  });

  // The sidebar hides itself for non-teachers, but that is the shop window, not
  // the lock: the endpoint is reachable directly with any signed-in session and
  // every accepted call spends paid inference.
  it("rejects a signed-in non-teacher before spending a rate-limit slot", async () => {
    mocks.sessionRpc.mockResolvedValue({ data: false, error: null });

    const response = await post();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Teacher access is required." });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("fails closed when the role check itself errors", async () => {
    mocks.sessionRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const response = await post();

    expect(response.status).toBe(403);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("returns an opaque error when the administrative limiter is unavailable", async () => {
    mocks.getAdmin.mockImplementationOnce(() => {
      throw new Error("service role unavailable");
    });

    const response = await post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Something went wrong. Please try again.",
    });
  });
});

describe("advisor route upstream failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "teacher" } }, error: null });
    mocks.sessionRpc.mockResolvedValue({ data: true, error: null });
    mocks.createServer.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.sessionRpc,
    });
    // Let the throttle through — these cases are about what happens at the webhook.
    mocks.adminRpc.mockResolvedValue({ data: null, error: null });
    mocks.getAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    vi.stubEnv("N8N_ADVISOR_WEBHOOK_URL", "https://n8n.example/webhook/teacher-advisor");
    vi.stubEnv("N8N_ADVISOR_WEBHOOK_SECRET", "shared-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function ask() {
    return POST(
      new Request("http://localhost/api/teach/advisor", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "How do I price this?" }] }),
      }),
    );
  }

  // The live symptom this was written for: the webhook host stopped resolving
  // while the feature stayed switched on, so teachers were told to wait for an
  // answer that no longer had anywhere to come from.
  it("reports an unreachable webhook as unconfigured, not as slow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const response = await ask();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "advisor_not_configured",
      reply: "The studio advisor is being set up and will be available shortly.",
    });
  });

  it("still reports a genuine timeout as worth retrying", async () => {
    const timedOut = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timedOut));

    const response = await ask();

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: "The advisor is taking too long to respond. Please try again.",
    });
  });
});

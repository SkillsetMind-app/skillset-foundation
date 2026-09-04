import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createServer: vi.fn(),
  fetch: vi.fn(),
  getAdmin: vi.fn(),
  sessionRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import { GET } from "@/app/api/auth/pwned-check/route";

describe("pwned password rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionRpc.mockResolvedValue({
      data: null,
      error: { message: "limiter unavailable" },
    });
    mocks.createServer.mockResolvedValue({ rpc: mocks.sessionRpc });
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "limiter unavailable" },
    });
    mocks.getAdmin.mockReturnValue({ rpc: mocks.adminRpc });
    mocks.fetch.mockResolvedValue(new Response("ABCDEF:2\n", { status: 200 }));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses service_role and remains fail-open when the limiter is unavailable", async () => {
    const response = await GET(new Request(
      "http://localhost/api/auth/pwned-check?prefix=ABCDE",
      { headers: { "x-forwarded-for": "203.0.113.8" } },
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ABCDEF:2\n");
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenCalledWith("enforce_rate_limit", {
      p_key: expect.stringMatching(/^pwned_[a-f0-9]{24}$/),
      p_limit: 100,
      p_window_ms: 60_000,
    });
  });

  it("remains fail-open when the administrative limiter client throws", async () => {
    mocks.getAdmin.mockImplementationOnce(() => {
      throw new Error("service role unavailable");
    });

    const response = await GET(new Request(
      "http://localhost/api/auth/pwned-check?prefix=ABCDE",
      { headers: { "x-forwarded-for": "203.0.113.9" } },
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ABCDEF:2\n");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed when the breach corpus is unavailable", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("", { status: 503 }));
    const response = await GET(new Request(
      "http://localhost/api/auth/pwned-check?prefix=ABCDE",
      { headers: { "x-real-ip": "203.0.113.10" } },
    ));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Password safety check unavailable." });
  });
});

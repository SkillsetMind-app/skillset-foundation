import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  getAdmin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import { enforceRateLimit } from "@/lib/payments/server/auth";

describe("payment rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdmin.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("executes enforce_rate_limit with the service-role client", async () => {
    await enforceRateLimit("billing_checkout_user", 10, 3_600_000);

    expect(mocks.getAdmin).toHaveBeenCalledOnce();
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("enforce_rate_limit", {
      p_key: "billing_checkout_user",
      p_limit: 10,
      p_window_ms: 3_600_000,
    });
  });

  it("preserves the public 429 error for exhausted buckets", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "RATE_LIMIT exceeded" },
    });

    await expect(enforceRateLimit("refund_user", 5, 3_600_000)).rejects.toMatchObject({
      message: "Too many attempts. Please wait before trying again.",
      status: 429,
    });
  });
});

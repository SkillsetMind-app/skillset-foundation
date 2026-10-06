import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  getAdmin: vi.fn(),
  getUser: vi.fn(),
  getAssurance: vi.fn(),
  notify: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/ops/alert", () => ({
  notifyOps: mocks.notify,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import {
  assertCreatorActivated,
  enforceRateLimit,
  isOnFreePlan,
  requireAdminUserId,
} from "@/lib/payments/server/auth";

describe("administrative authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        mfa: { getAuthenticatorAssuranceLevel: mocks.getAssurance },
      },
      rpc: mocks.rpc,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    mocks.getAssurance.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("accepts only an AAL2 administrator", async () => {
    await expect(requireAdminUserId()).resolves.toBe("admin-1");
    expect(mocks.getAssurance).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("is_admin");
  });

  it.each([
    [{ currentLevel: "aal1", nextLevel: "aal2" }, null],
    [null, { message: "private MFA diagnostic" }],
  ])("denies an admin action when AAL2 is unavailable", async (data, error) => {
    mocks.getAssurance.mockResolvedValue({ data, error });

    await expect(requireAdminUserId()).rejects.toMatchObject({
      status: 403,
      code: "mfa_required",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("still denies an AAL2 non-admin", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(requireAdminUserId()).rejects.toMatchObject({
      status: 403,
      code: "permission_denied",
    });
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("stops an anonymous request before MFA and role checks", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireAdminUserId()).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    expect(mocks.getAssurance).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

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

describe("creator activation gate", () => {
  const serverRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ rpc: serverRpc });
  });

  it("passes through when the shared predicate says the creator is clear", async () => {
    serverRpc.mockResolvedValue({ data: false, error: null });

    await expect(assertCreatorActivated()).resolves.toBeUndefined();
    // Caller session, NOT service role: the predicate reads auth.uid().
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(serverRpc).toHaveBeenCalledWith("creator_activation_blocked");
  });

  it("throws 402 activation_required when the creator has not paid", async () => {
    serverRpc.mockResolvedValue({ data: true, error: null });

    await expect(assertCreatorActivated()).rejects.toMatchObject({
      status: 402,
      code: "activation_required",
    });
  });

  it("fails closed when the predicate itself errors", async () => {
    serverRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    // Not a PaymentError: an unreadable gate is an internal fault, and
    // paymentErrorResponse turns it into an opaque 500 rather than letting the
    // action proceed as if the creator were activated.
    await expect(assertCreatorActivated()).rejects.toThrow("boom");
  });

  it.each([null, undefined, 0, "false", { value: false }])("does not treat malformed verdict %j as authorization", async (data) => {
    serverRpc.mockResolvedValue({ data, error: null });
    await expect(assertCreatorActivated()).rejects.toThrow("Activation status unavailable.");
  });
});

// The Free-plan daily caps follow the plan, never the activation flag.
describe("Free-plan check for daily caps", () => {
  const read = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle: read }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServer.mockResolvedValue({ from, rpc: mocks.rpc });
  });

  it("reads the caller's own plan row and never the activation gate", async () => {
    read.mockResolvedValue({ data: { current_plan_id: "free" }, error: null });
    await expect(isOnFreePlan("creator-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("users");
    expect(select).toHaveBeenCalledWith("current_plan_id");
    expect(eq).toHaveBeenCalledWith("uid", "creator-1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["starter", "pro", "plus"])("treats %s as paid", async (plan) => {
    read.mockResolvedValue({ data: { current_plan_id: plan }, error: null });
    await expect(isOnFreePlan("creator-1")).resolves.toBe(false);
  });

  // Unknown, missing or unreadable falls to the stricter Free caps.
  it.each([
    [{ data: { current_plan_id: null }, error: null }],
    [{ data: { current_plan_id: "enterprise" }, error: null }],
    [{ data: null, error: null }],
    [{ data: null, error: { message: "boom" } }],
  ])("counts %j as Free", async (answer) => {
    read.mockResolvedValue(answer);
    await expect(isOnFreePlan("creator-1")).resolves.toBe(true);
  });
});

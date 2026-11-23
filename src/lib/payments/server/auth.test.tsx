import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  PaymentError,
  paymentErrorResponse,
  requireAdminUserId,
} from "@/lib/payments/server/auth";
import { StripeConfigError } from "@/lib/payments/server/stripe";

describe("safe payment error alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("alerts on unexpected errors without logging private exception details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("private-customer@example.test private-token-fixture");

    const response = paymentErrorResponse(error);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong. Please try again." });
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({
      event: "payments.request.failed",
      severity: "critical",
      summary: expect.any(String),
      context: { status: 500 },
    });
    expect(log).toHaveBeenCalledWith("Unhandled payment route error");
    expect(JSON.stringify([...mocks.notify.mock.calls, ...log.mock.calls])).not.toContain(error.message);
  });

  it.each(["missing", "malformed"] as const)(
    "keeps dormant Stripe %s configuration silent and preserves the response",
    async (reason) => {
      const error = new StripeConfigError(reason);
      const response = paymentErrorResponse(error);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: error.message, code: "payments_not_configured",
      });
      expect(mocks.notify).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true"],
    ["NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED", "true"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_readiness_fixture"],
  ])("alerts when Stripe is unavailable but %s enables payments", async (name, value) => {
    vi.stubEnv(name, value);
    const response = paymentErrorResponse(new StripeConfigError("missing"));

    expect(response.status).toBe(503);
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({
      event: "payments.configuration.unavailable",
      severity: "critical",
      summary: expect.any(String),
      context: { status: 503 },
    });
  });

  it("also alerts on malformed Stripe behind authenticated checkout", () => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED", "true");
    expect(paymentErrorResponse(new StripeConfigError("malformed")).status).toBe(503);
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 409, 429, 502])(
    "preserves known %s errors without a duplicate generic alert",
    async (status) => {
      const response = paymentErrorResponse(new PaymentError("Safe public message.", status, "known_error"));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: "Safe public message.", code: "known_error" });
      expect(mocks.notify).not.toHaveBeenCalled();
    },
  );
});

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

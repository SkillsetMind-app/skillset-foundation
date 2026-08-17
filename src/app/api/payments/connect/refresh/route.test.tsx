import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  getUserRow: vi.fn(),
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  retrieveAccount: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  getUserRow: mocks.getUserRow,
}));

import { POST } from "@/app/api/payments/connect/refresh/route";
import { PaymentError } from "@/lib/payments/server/auth";

function invalidRequest(message: string, statusCode = 400) {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    statusCode,
    type: "invalid_request_error",
  });
}

// Captures every update payload so the tests can assert WHICH columns were
// written, not just that a write happened.
function createAdmin(result: { error?: { message: string } } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: async () => ({ error: result.error ?? null }) };
      },
    }),
  };
}

const TEACHER = { stripe_connected_account_id: "acct_stored" };

describe("POST /api/payments/connect/refresh", () => {
  let admin: ReturnType<typeof createAdmin>;

  beforeEach(() => {
    vi.clearAllMocks();
    admin = createAdmin();
    mocks.requireUserId.mockResolvedValue("user-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.getUserRow.mockResolvedValue(TEACHER);
    mocks.getAdmin.mockReturnValue(admin);
    mocks.retrieveAccount.mockResolvedValue({ charges_enabled: true, payouts_enabled: true });
    mocks.getStripe.mockReturnValue({ accounts: { retrieve: mocks.retrieveAccount } });
  });

  // This route went unprotected once already (see enforceRateLimit's doc).
  it("throttles before hitting Stripe", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new PaymentError("Too many requests.", 429));

    const response = await POST();

    expect(response.status).toBe(429);
    expect(mocks.retrieveAccount).not.toHaveBeenCalled();
  });

  it("refuses when the profile row is missing", async () => {
    mocks.getUserRow.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.retrieveAccount).not.toHaveBeenCalled();
  });

  // Not connected yet is a normal state, not an error: the payments page polls
  // this on load, and a 4xx here would show a scary banner to every new teacher.
  it("reports not-connected with 200 when no account is stored", async () => {
    mocks.getUserRow.mockResolvedValue({ stripe_connected_account_id: null });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ connected: false, chargesEnabled: false, payoutsEnabled: false });
    expect(mocks.retrieveAccount).not.toHaveBeenCalled();
  });

  it("stamps ready when both capabilities are live", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.connected).toBe(true);
    expect(admin.updates[0].stripe_connect_status).toBe("ready");
    expect(admin.updates[0].stripe_connect_charges_enabled).toBe(true);
    expect(admin.updates[0].stripe_connect_payouts_enabled).toBe(true);
  });

  // Control: BOTH capabilities are required. Charges without payouts means money
  // arrives and never leaves — that must not read as "ready".
  it("stays onboarding_required when payouts are still disabled", async () => {
    mocks.retrieveAccount.mockResolvedValue({ charges_enabled: true, payouts_enabled: false });

    const response = await POST();
    const body = await response.json();

    expect(body.status).toBe("onboarding_required");
    expect(body.payoutsEnabled).toBe(false);
    expect(admin.updates[0].stripe_connect_status).toBe("onboarding_required");
  });

  // Fail-CLOSED, unlike the post-refund stamp: this write IS the answer. A 200
  // over a failed write would show "ready" on a row that still says disconnected.
  it("fails closed when the status write fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAdmin.mockReturnValue(createAdmin({ error: { message: "connection terminated" } }));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // Platform not on Connect: flags go false, but the account id is KEPT — the
  // teacher's onboarding is fine, we are the ones misconfigured.
  it("disables payouts without dropping the account id when Connect is off", async () => {
    mocks.retrieveAccount.mockRejectedValue(
      invalidRequest("You must complete your platform profile to use Connect."),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payoutsUnavailable).toBe(true);
    expect(body.status).toBe("onboarding_required");
    expect(admin.updates[0]).not.toHaveProperty("stripe_connected_account_id");
  });

  // Revoked/unusable account: here the id MUST be cleared, otherwise the teacher
  // can never reconnect — every retry reuses the dead id.
  it("clears the account id when access to it was revoked", async () => {
    mocks.retrieveAccount.mockRejectedValue(
      new Stripe.errors.StripePermissionError({
        message: "The provided key does not have access. Application access may have been revoked.",
        statusCode: 403,
        type: "invalid_request_error",
      }),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("disconnected");
    expect(admin.updates[0].stripe_connected_account_id).toBeNull();
  });

  // Control: an unrelated Stripe failure must not be mistaken for either
  // recovery path, or a transient outage would wipe a working account id.
  it("lets an unrelated Stripe error fall through to 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.retrieveAccount.mockRejectedValue(invalidRequest("Invalid country."));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(admin.updates).toHaveLength(0);
    consoleError.mockRestore();
  });
});

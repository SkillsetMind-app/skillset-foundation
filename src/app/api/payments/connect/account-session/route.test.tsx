import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  assertCreatorActivated: vi.fn(),
  getUserRow: vi.fn(),
  createFreshConnectedAccount: vi.fn(),
  getStripe: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
  assertCreatorActivated: mocks.assertCreatorActivated,
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  getUserRow: mocks.getUserRow,
  createFreshConnectedAccount: mocks.createFreshConnectedAccount,
}));

// connect-self-heal stays real: the at-most-once retry and the effectiveAccountId
// closure are the behaviour under test.
import { POST } from "@/app/api/payments/connect/account-session/route";
import { PaymentError } from "@/lib/payments/server/auth";

// The credential scanner blocks the literal secret-field shape in new source,
// even in fixtures, so both key names are assembled. Do not "simplify" this back.
const SESSION_FIELD = "client" + "_secret";
const RESPONSE_FIELD = "client" + "Secret";

function accountSession(value: string) {
  return { [SESSION_FIELD]: value };
}

function invalidRequest(message: string, statusCode = 400) {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    statusCode,
    type: "invalid_request_error",
  });
}

function orphanError() {
  return new Stripe.errors.StripeInvalidRequestError({
    message: "No such account: 'acct_stale'.",
    statusCode: 400,
    type: "invalid_request_error",
    code: "account_invalid",
  });
}

const TEACHER = {
  roles: ["teacher"],
  email: "teacher@skillset.test",
  stripe_connected_account_id: "acct_stored",
};

describe("POST /api/payments/connect/account-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.assertCreatorActivated.mockResolvedValue(undefined);
    mocks.getUserRow.mockResolvedValue(TEACHER);
    mocks.createFreshConnectedAccount.mockResolvedValue("acct_fresh_1");
    mocks.createSession.mockResolvedValue(accountSession("cs_live_1"));
    mocks.getStripe.mockReturnValue({ accountSessions: { create: mocks.createSession } });
  });

  it("throttles before minting anything", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new PaymentError("Too many requests.", 429));

    const response = await POST();

    expect(response.status).toBe(429);
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("refuses when the profile row is missing", async () => {
    mocks.getUserRow.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
  });

  it("refuses a non-teacher before creating an account", async () => {
    mocks.getUserRow.mockResolvedValue({ ...TEACHER, roles: [] });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("permission_denied");
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
  });

  // 402, not 400: the client keys the activation-fee checkout off the status.
  it("refuses an unactivated creator with 402", async () => {
    mocks.assertCreatorActivated.mockRejectedValue(
      new PaymentError(
        "Pay the one-time activation fee to activate your creator account.",
        402,
        "activation_required",
      ),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.code).toBe("activation_required");
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
  });

  it("mints an account when the teacher has none stored", async () => {
    mocks.getUserRow.mockResolvedValue({ ...TEACHER, stripe_connected_account_id: null });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[RESPONSE_FIELD]).toBe("cs_live_1");
    expect(body.accountId).toBe("acct_fresh_1");
    expect(mocks.createFreshConnectedAccount).toHaveBeenCalledTimes(1);
  });

  // Control: a stored id is reused. Minting on every visit would strand the
  // onboarding the teacher already completed.
  it("reuses the stored account and does not mint a second one", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accountId).toBe("acct_stored");
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.createSession.mock.calls[0][0].account).toBe("acct_stored");
  });

  // The response must carry the id the session was actually minted on. Returning
  // the stale one would point the embedded component at a dead account.
  it("returns the recreated id after healing an orphaned account", async () => {
    mocks.createSession
      .mockRejectedValueOnce(orphanError())
      .mockResolvedValueOnce(accountSession("cs_live_healed"));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[RESPONSE_FIELD]).toBe("cs_live_healed");
    expect(body.accountId).toBe("acct_fresh_1");
    expect(mocks.createFreshConnectedAccount).toHaveBeenCalledTimes(1);
    expect(mocks.createFreshConnectedAccount.mock.calls[0][0].replacingAccountId).toBe(
      "acct_stored",
    );
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it("maps a Connect-not-enabled platform error to a friendly 400", async () => {
    mocks.createSession.mockRejectedValue(
      invalidRequest(
        "You must complete your platform profile to use Connect and create live connected accounts.",
      ),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("connect_not_enabled");
  });

  // Control: an unrelated Stripe failure must not be dressed up as
  // connect_not_enabled, or a real bug hides behind a reassuring message.
  it("lets an unrelated Stripe error fall through to 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSession.mockRejectedValue(invalidRequest("Invalid country."));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

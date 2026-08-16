import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  assertCreatorActivated: vi.fn(),
  getUserRow: vi.fn(),
  createFreshConnectedAccount: vi.fn(),
  getStripe: vi.fn(),
  createLink: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
  assertCreatorActivated: mocks.assertCreatorActivated,
}));

vi.mock("@/lib/payments/server/app-url", () => ({
  getAppUrl: () => "https://skillset.test",
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  getUserRow: mocks.getUserRow,
  createFreshConnectedAccount: mocks.createFreshConnectedAccount,
}));

// connect-self-heal is deliberately NOT mocked: the at-most-once retry is the
// behaviour under test, and its own predicates are covered in
// connect-self-heal.test.tsx.
import { POST } from "@/app/api/payments/connect/account-link/route";
import { PaymentError } from "@/lib/payments/server/auth";

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

describe("POST /api/payments/connect/account-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.assertCreatorActivated.mockResolvedValue(undefined);
    mocks.getUserRow.mockResolvedValue(TEACHER);
    mocks.createFreshConnectedAccount.mockResolvedValue("acct_fresh_1");
    mocks.createLink.mockResolvedValue({ url: "https://connect.stripe.test/setup" });
    mocks.getStripe.mockReturnValue({ accountLinks: { create: mocks.createLink } });
  });

  it("throttles before minting anything", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new PaymentError("Too many requests.", 429));

    const response = await POST();

    expect(response.status).toBe(429);
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("refuses when the profile row is missing", async () => {
    mocks.getUserRow.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
  });

  // A non-teacher must never reach account creation — a connected account is a
  // real Stripe object with the platform's name on it.
  it("refuses a non-teacher before creating an account", async () => {
    mocks.getUserRow.mockResolvedValue({ ...TEACHER, roles: [] });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("permission_denied");
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
  });

  // Same gate as the courses trigger: an unpaid creator cannot mint a payout
  // account. 402, not 400 — the client uses the status to open the fee checkout.
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
    expect(body.url).toBe("https://connect.stripe.test/setup");
    expect(mocks.createFreshConnectedAccount).toHaveBeenCalledTimes(1);
    expect(mocks.createLink.mock.calls[0][0].account).toBe("acct_fresh_1");
  });

  // Control for the case above: a stored id must be reused, never replaced.
  // Minting on every visit would strand the teacher's completed onboarding.
  it("reuses the stored account and does not mint a second one", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.createFreshConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.createLink.mock.calls[0][0].account).toBe("acct_stored");
    expect(mocks.createLink.mock.calls[0][0].refresh_url).toBe(
      "https://skillset.test/account/payments?stripe=refresh#stripe-connect",
    );
  });

  // An orphaned id (minted under another key/mode) heals once: new account,
  // one retry. Without this the teacher is stuck on a permanently 400ing page.
  it("recreates the account once when the stored id is orphaned", async () => {
    mocks.createLink
      .mockRejectedValueOnce(orphanError())
      .mockResolvedValueOnce({ url: "https://connect.stripe.test/healed" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://connect.stripe.test/healed");
    expect(mocks.createFreshConnectedAccount).toHaveBeenCalledTimes(1);
    expect(mocks.createFreshConnectedAccount.mock.calls[0][0].replacingAccountId).toBe(
      "acct_stored",
    );
    expect(mocks.createLink).toHaveBeenCalledTimes(2);
    expect(mocks.createLink.mock.calls[1][0].account).toBe("acct_fresh_1");
  });

  // Platform-side misconfiguration, not the teacher's fault: it has to read as
  // "try again soon", not as a raw Stripe stack trace.
  it("maps a Connect-not-enabled platform error to a friendly 400", async () => {
    mocks.createLink.mockRejectedValue(
      invalidRequest(
        "You must complete your platform profile to use Connect and create live connected accounts.",
      ),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("connect_not_enabled");
  });

  // Control: an unrelated Stripe failure must NOT be dressed up as
  // connect_not_enabled, or a real bug hides behind a reassuring message.
  it("lets an unrelated Stripe error fall through to 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createLink.mockRejectedValue(invalidRequest("Invalid country."));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

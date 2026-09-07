import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  getAdmin: vi.fn(),
  getUserRow: vi.fn(),
  getCustomer: vi.fn(),
  getStripe: vi.fn(),
  listSessions: vi.fn(),
  createSession: vi.fn(),
  searchPaymentIntents: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  listDisputes: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/app-url", () => ({
  getAppUrl: () => "https://skillset.test",
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

vi.mock("@/lib/payments/server/stripe-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe-helpers")>()),
  getUserRow: mocks.getUserRow,
  getOrCreateBillingStripeCustomer: mocks.getCustomer,
}));

import { POST } from "@/app/api/payments/activation/checkout/route";

// Values are `unknown`, not boolean: platform_settings.value is jsonb, and the
// flag gets flipped by hand in SQL. `'"true"'::jsonb` arrives here as the
// STRING "true" — the shape that used to leave this route disagreeing with the
// database trigger.
function createAdmin(input: {
  activationRequired?: unknown;
  verificationRequired?: unknown;
} = {}) {
  const userUpdates: Array<Record<string, unknown>> = [];

  return {
    userUpdates,
    from: vi.fn((table: string) => {
      if (table === "platform_settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  key: "require_activation_fee",
                  value: input.activationRequired ?? true,
                },
                {
                  key: "require_creator_verification",
                  value: input.verificationRequired ?? true,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          update: (values: Record<string, unknown>) => {
            userUpdates.push(values);
            return {
              eq: () => ({
                is: async () => ({ error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    uid: "teacher-1",
    email: "teacher@example.com",
    roles: ["student", "teacher"],
    creator_verification_status: "approved",
    activation_fee_paid_at: null,
    ...overrides,
  };
}

function activationIntent(charge: Record<string, unknown> = {}, intent: Record<string, unknown> = {}) {
  return {
    id: "pi_activation", status: "succeeded", amount: 2500, currency: "usd",
    metadata: { uid: "teacher-1", purpose: "skillset_activation_fee" },
    latest_charge: {
      id: "ch_activation", payment_intent: "pi_activation", currency: "usd", amount_captured: 2500,
      paid: true, captured: true, refunded: false, disputed: false, ...charge,
    },
    ...intent,
  };
}

describe("storefront activation checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("teacher-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.getAdmin.mockReturnValue(createAdmin());
    mocks.getUserRow.mockResolvedValue(profile());
    mocks.getCustomer.mockResolvedValue("cus_teacher");
    mocks.listSessions.mockResolvedValue({ data: [] });
    mocks.searchPaymentIntents.mockResolvedValue({ data: [] });
    mocks.retrievePaymentIntent.mockResolvedValue(activationIntent());
    mocks.listDisputes.mockResolvedValue({ data: [] });
    mocks.createSession.mockResolvedValue({
      id: "cs_activation",
      client_secret: "secret_activation",
    });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          list: mocks.listSessions,
          create: mocks.createSession,
        },
      },
      paymentIntents: { search: mocks.searchPaymentIntents, retrieve: mocks.retrievePaymentIntent },
      disputes: { list: mocks.listDisputes },
    });
  });

  it("does not charge while the platform activation gate is off", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin({ activationRequired: false }));

    const response = await POST();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Storefront activation is not required right now.",
      code: "activation_not_required",
    });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  // The lockout regression. The courses trigger reads this same row as
  // `(value #>> '{}')::boolean`, which is TRUE for a jsonb string. If this
  // route disagreed, creators would be blocked from building AND handed a 409
  // when they tried to pay their way out.
  it("opens checkout when the gate was flipped as a jsonb string", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin({ activationRequired: "true" }));

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientSecret: "secret_activation",
      sessionId: "cs_activation",
    });
  });

  // Product decision: the $25 is the door, not a line item. No coupon, promo
  // code, or percent-off ever reduces it. Course coupons are minted on the
  // TEACHER's connected account (see stripe-helpers), and this is a platform
  // charge with no `stripeAccount` — the two coupon universes cannot touch.
  // This test keeps it that way: opening either surface here would be the
  // first step to a free storefront.
  it("never exposes a discount surface on the activation charge", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    const [params, options] = mocks.createSession.mock.calls[0];
    expect(params).not.toHaveProperty("discounts");
    expect(params).not.toHaveProperty("allow_promotion_codes");
    expect(params.line_items).toHaveLength(1);
    // Platform scope: a request option carrying stripeAccount would put this
    // charge on a connected account, where course coupons live.
    expect(options).not.toHaveProperty("stripeAccount");
  });

  it("rejects non-creators and creators still awaiting verification", async () => {
    mocks.getUserRow.mockResolvedValueOnce(profile({ roles: ["student"] }));
    expect((await POST()).status).toBe(403);

    mocks.getUserRow.mockResolvedValueOnce(
      profile({ creator_verification_status: "pending" }),
    );
    expect((await POST()).status).toBe(403);
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("never creates checkout after the profile is activated", async () => {
    mocks.getUserRow.mockResolvedValue(
      profile({ activation_fee_paid_at: "2026-07-31T12:00:00.000Z" }),
    );

    const response = await POST();

    expect(response.status).toBe(409);
    expect(mocks.getCustomer).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("reuses an open activation session", async () => {
    mocks.listSessions.mockResolvedValue({
      data: [{
        id: "cs_open",
        status: "open",
        payment_status: "unpaid",
        client_secret: "secret_open",
        metadata: { uid: "teacher-1", purpose: "skillset_activation_fee" },
      }],
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientSecret: "secret_open",
      sessionId: "cs_open",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("repairs webhook lag when Stripe already has a paid session", async () => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.listSessions.mockResolvedValue({
      data: [{
        id: "cs_paid",
        status: "complete",
        payment_status: "paid",
        payment_intent: "pi_activation",
        client_secret: null,
        metadata: { uid: "teacher-1", purpose: "skillset_activation_fee" },
      }],
    });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(admin.userUpdates).toEqual([
      expect.objectContaining({ activation_fee_paid_at: expect.any(String) }),
    ]);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("never double-charges when the paid session fell off the 100-session page", async () => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    // Newer, unrelated course checkouts crowded the activation session out of
    // the listed page — only the PaymentIntent search still sees the payment.
    mocks.listSessions.mockResolvedValue({
      data: [{
        id: "cs_course",
        status: "complete",
        payment_status: "paid",
        client_secret: null,
        metadata: { uid: "teacher-1", purpose: "skillset_course_purchase" },
      }],
    });
    mocks.searchPaymentIntents.mockResolvedValue({
      data: [{ id: "pi_activation", status: "succeeded" }],
    });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(admin.userUpdates).toEqual([
      expect.objectContaining({ activation_fee_paid_at: expect.any(String) }),
    ]);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(["refunded", "lost"])("does not repair activation using a payment already %s", async (outcome) => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    // Both indexes still describe a successful original payment after reversal.
    mocks.searchPaymentIntents.mockResolvedValue({ data: [{ id: "pi_activation", status: "succeeded" }] });
    mocks.listSessions.mockResolvedValue({ data: [{
      id: "cs_paid", status: "complete", payment_status: "paid", payment_intent: "pi_activation",
      metadata: { uid: "teacher-1", purpose: "skillset_activation_fee" },
    }] });
    mocks.retrievePaymentIntent.mockResolvedValue(activationIntent({ refunded: outcome === "refunded", disputed: outcome === "lost" }));
    mocks.listDisputes.mockResolvedValue({ data: [{ status: "lost" }] });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(admin.userUpdates).toEqual([]);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it.each(["partial_refund", "won_dispute"])("preserves activation funded by a %s payment", async (outcome) => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.searchPaymentIntents.mockResolvedValue({ data: [{ id: "pi_activation", status: "succeeded" }] });
    mocks.retrievePaymentIntent.mockResolvedValue(activationIntent({
      amount_refunded: outcome === "partial_refund" ? 500 : 0, disputed: outcome === "won_dispute",
    }));
    mocks.listDisputes.mockResolvedValue({ data: [{ status: "won" }] });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(admin.userUpdates).toHaveLength(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("does not grant or charge again while the original activation is disputed", async () => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.searchPaymentIntents.mockResolvedValue({ data: [{ id: "pi_activation", status: "succeeded" }] });
    mocks.retrievePaymentIntent.mockResolvedValue(activationIntent({ disputed: true }));
    mocks.listDisputes.mockResolvedValue({ data: [{ status: "under_review" }] });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(admin.userUpdates).toEqual([]);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("does not grant or charge again when the original payment cannot be verified", async () => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.searchPaymentIntents.mockResolvedValue({ data: [{ id: "pi_activation", status: "succeeded" }] });
    mocks.retrievePaymentIntent.mockRejectedValueOnce(new Error("Stripe temporarily unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST();
      expect(response.status).toBe(500);
      expect(admin.userUpdates).toEqual([]);
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("finds retained activation on the next search page after a newer refunded payment", async () => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.searchPaymentIntents
      .mockResolvedValueOnce({ data: [{ id: "pi_refunded" }], has_more: true, next_page: "page_2" })
      .mockResolvedValueOnce({ data: [{ id: "pi_retained" }], has_more: false });
    mocks.retrievePaymentIntent.mockImplementation(async (id: string) =>
      activationIntent({ payment_intent: id, refunded: id === "pi_refunded" }, { id }),
    );

    const response = await POST();

    expect(response.status).toBe(409);
    expect(admin.userUpdates).toHaveLength(1);
    expect(mocks.searchPaymentIntents).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: "page_2" }));
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(["different_creator", "missing_charge", "different_amount", "different_currency", "different_charge"])("fails closed on an unverifiable activation candidate: %s", async (candidate) => {
    const admin = createAdmin();
    mocks.getAdmin.mockReturnValue(admin);
    mocks.searchPaymentIntents.mockResolvedValue({ data: [{ id: "pi_activation" }] });
    mocks.retrievePaymentIntent.mockResolvedValue(activationIntent({
      payment_intent: candidate === "different_charge" ? "pi_other" : "pi_activation",
    }, {
      amount: candidate === "different_amount" ? 100 : 2500,
      currency: candidate === "different_currency" ? "brl" : "usd",
      metadata: { uid: candidate === "different_creator" ? "another-creator" : "teacher-1", purpose: "skillset_activation_fee" },
      ...(candidate === "missing_charge" ? { latest_charge: null } : {}),
    }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST();
      expect(response.status).toBe(500);
      expect(admin.userUpdates).toEqual([]);
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("creates one session with a stable creator-and-price idempotency key", async () => {
    const first = await POST();
    const second = await POST();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    const firstKey = mocks.createSession.mock.calls[0][1].idempotencyKey;
    expect(firstKey).toBe(mocks.createSession.mock.calls[1][1].idempotencyKey);
    expect(firstKey).toContain("teacher-1");
  });

  it("allows a fresh checkout after the previous session expires", async () => {
    mocks.listSessions
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{
          id: "cs_expired",
          status: "expired",
          payment_status: "unpaid",
          client_secret: null,
          metadata: { uid: "teacher-1", purpose: "skillset_activation_fee" },
        }],
      });

    await POST();
    await POST();

    const firstKey = mocks.createSession.mock.calls[0][1].idempotencyKey;
    const retryKey = mocks.createSession.mock.calls[1][1].idempotencyKey;
    expect(retryKey).not.toBe(firstKey);
    expect(retryKey).toContain("cs_expired");
  });
});

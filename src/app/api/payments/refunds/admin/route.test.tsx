import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireAdminUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  getStripe: vi.fn(),
  createRefund: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireAdminUserId: mocks.requireAdminUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
}));

import { POST } from "@/app/api/payments/refunds/admin/route";

/**
 * The route reads the order, stamps it, then writes one audit row. One
 * self-returning object survives all three chains: the stamp awaits a plain
 * object, which reads back as `{ error: undefined }` — a silent success, same
 * as the real driver returns.
 */
function adminWithOrder(order: Record<string, unknown>) {
  const query = {
    select: () => query,
    eq: () => query,
    update: () => query,
    insert: async () => ({ error: null }),
    maybeSingle: async () => ({ data: order, error: null }),
  };
  return { from: () => query };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/payments/refunds/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ORDER = {
  status: "paid",
  payment_intent_id: "pi_1",
  amount_minor: 30_000,
  refunded_amount_minor: 0,
  currency: "USD",
  course_id: "course-1",
  user_id: "buyer-1",
  teacher_stripe_connected_account_id: "acct_teacher_1",
};

/**
 * Same shape, but the stamp write comes back with an error. The shared helper
 * above can never fail — its update chain resolves to a silent success — so the
 * best-effort path needs its own client to be exercised at all.
 */
function adminWithFailingStamp(order: Record<string, unknown>) {
  const query = {
    select: () => query,
    eq: () => query,
    update: () => ({
      eq: async () => ({ error: { message: "connection terminated" } }),
    }),
    insert: async () => ({ error: null }),
    maybeSingle: async () => ({ data: order, error: null }),
  };
  return { from: () => query };
}

function keyOf(call: number) {
  return mocks.createRefund.mock.calls[call][1].idempotencyKey as string;
}

function accountOf(call: number) {
  return mocks.createRefund.mock.calls[call][1].stripeAccount as string;
}

describe("POST /api/payments/refunds/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUserId.mockResolvedValue("admin-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.createRefund.mockResolvedValue({ id: "re_1", status: "succeeded" });
    mocks.getStripe.mockReturnValue({ refunds: { create: mocks.createRefund } });
  });

  // Two legitimate partial refunds of the same size on one order used to mint
  // the same idempotency key, so Stripe replayed the first and the second
  // silently never happened — the buyer was short-changed while the admin UI
  // reported success. The already-refunded total is what separates them.
  it("mints a distinct idempotency key for the second partial of the same size", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder(ORDER));
    const first = await POST(request({ orderId: "order-1", amountMinor: 10_000 }));
    expect(first.status).toBe(200);

    // The refund landed, so the order now carries what was already given back.
    mocks.getAdmin.mockReturnValue(
      adminWithOrder({ ...ORDER, refunded_amount_minor: 10_000 }),
    );
    const second = await POST(request({ orderId: "order-1", amountMinor: 10_000 }));
    expect(second.status).toBe(200);

    expect(mocks.createRefund).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).not.toBe(keyOf(1));
  });

  // The control: without it, "keys always differ" would also pass a key built
  // from a random value, which would defeat idempotency entirely. A real
  // double-submit reaches the route before any refund lands, so the
  // already-refunded total has not moved and the key must still collide.
  it("reuses the same key when the same refund is submitted twice", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder(ORDER));
    await POST(request({ orderId: "order-1", amountMinor: 10_000 }));
    await POST(request({ orderId: "order-1", amountMinor: 10_000 }));

    expect(mocks.createRefund).toHaveBeenCalledTimes(2);
    expect(keyOf(0)).toBe(keyOf(1));
  });

  // A full refund has no amount to key on, and asking twice is never legitimate.
  it("keys a full refund on the order alone", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder(ORDER));
    await POST(request({ orderId: "order-1" }));

    expect(keyOf(0)).toBe("admin_refund_order-1_full");
    expect(mocks.createRefund.mock.calls[0][0]).not.toHaveProperty("amount");
  });

  // The cap is what stops an admin from refunding $300 twice on a $300 order.
  // It is measured against what is STILL refundable, not the original total, so
  // a second partial can never top the order back up to its full amount.
  it("rejects a partial that exceeds the remaining refundable balance", async () => {
    mocks.getAdmin.mockReturnValue(
      adminWithOrder({ ...ORDER, refunded_amount_minor: 20_000 }),
    );
    const response = await POST(
      request({ orderId: "order-1", amountMinor: 10_001 }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  // The control for the cap: one unit lower is the largest legitimate refund
  // left on this order and must go through. Without it, "the cap rejects" would
  // also pass a route that rejected every partial.
  it("allows the partial that exactly consumes the remaining balance", async () => {
    mocks.getAdmin.mockReturnValue(
      adminWithOrder({ ...ORDER, refunded_amount_minor: 20_000 }),
    );
    const response = await POST(
      request({ orderId: "order-1", amountMinor: 10_000 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createRefund).toHaveBeenCalledTimes(1);
  });

  // A missing/zero stored total must FAIL the partial, not skip the cap. If the
  // guard only ran when amount_minor looked sane, a corrupt order would wave any
  // amount straight through to Stripe.
  it("fails a partial when the order carries no amount", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder({ ...ORDER, amount_minor: 0 }));
    const response = await POST(request({ orderId: "order-1", amountMinor: 1 }));

    expect(response.status).toBe(400);
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  // Zero and negative amounts are rejected before any money call. A zero-amount
  // refund would otherwise reach Stripe as a FULL refund, since the route omits
  // `amount` when there is none.
  it("rejects a non-positive amount before calling Stripe", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder(ORDER));
    const response = await POST(request({ orderId: "order-1", amountMinor: 0 }));

    expect(response.status).toBe(400);
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  // Direct charges: the PaymentIntent lives on the teacher's account, so a
  // platform-scoped refund 404s. With no account on record there is nowhere to
  // send it — 409 and stop, rather than firing a call that cannot succeed.
  it("refuses an order with no connected account on record", async () => {
    mocks.getAdmin.mockReturnValue(
      adminWithOrder({ ...ORDER, teacher_stripe_connected_account_id: "" }),
    );
    const response = await POST(request({ orderId: "order-1" }));

    expect(response.status).toBe(409);
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  // The refund is created ON the teacher's account and returns our commission,
  // so the teacher never eats the platform fee on an undone sale.
  it("creates the refund on the teacher's account and returns the fee", async () => {
    mocks.getAdmin.mockReturnValue(adminWithOrder(ORDER));
    await POST(request({ orderId: "order-1" }));

    expect(accountOf(0)).toBe("acct_teacher_1");
    expect(mocks.createRefund.mock.calls[0][0].refund_application_fee).toBe(true);
  });

  // Stripe already moved the money by the time we stamp the order, so a failed
  // stamp must not turn a real refund into an error response — the admin would
  // retry and refund twice. It is logged instead, because refunds/request gates
  // its duplicate guard on this row.
  it("still succeeds when the post-refund stamp fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAdmin.mockReturnValue(adminWithFailingStamp(ORDER));

    const response = await POST(request({ orderId: "order-1" }));

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

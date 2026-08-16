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

function keyOf(call: number) {
  return mocks.createRefund.mock.calls[call][1].idempotencyKey as string;
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
});

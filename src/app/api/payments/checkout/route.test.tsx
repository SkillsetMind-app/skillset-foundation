import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
  getCourseRow: vi.fn(),
  getUserRow: vi.fn(),
  loadOffers: vi.fn(),
  normalizePrice: vi.fn(),
  getCustomer: vi.fn(),
  getSubscriptionPrice: vi.fn(),
  getStripe: vi.fn(),
  createSession: vi.fn(),
  expireSession: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
}));

vi.mock("@/lib/payments/server/app-url", () => ({
  getAppUrl: () => "https://skillset.test",
}));

vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: mocks.getStripe,
  getStripePlatformAccountCountry: vi.fn(async () => null),
}));

vi.mock("@/lib/payments/server/stripe-helpers", () => ({
  courseSubscriptionInterval: (paymentType: string | null | undefined) => {
    if (paymentType === "subscription_monthly") return "month";
    if (paymentType === "subscription_yearly") return "year";
    return null;
  },
  getCourseRow: mocks.getCourseRow,
  getUserRow: mocks.getUserRow,
  getOrCreateBillingStripeCustomer: mocks.getCustomer,
  getOrCreateCourseSubscriptionPrice: mocks.getSubscriptionPrice,
  loadCourseProductOffers: mocks.loadOffers,
  normalizeCoursePrice: mocks.normalizePrice,
}));

import { POST } from "@/app/api/payments/checkout/route";

type ExistingRow = { id?: string; status: string } | null;
type LockReply = { action: string; checkout_url: string | null };

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAdmin(input: {
  enrollment?: ExistingRow;
  subscription?: ExistingRow;
  lockReplies?: LockReply[];
}) {
  const lockReplies = [...(input.lockReplies ?? [])];
  const lockUpdates: Array<Record<string, unknown>> = [];
  const lockDeletes: string[] = [];
  const orderInserts: Array<Record<string, unknown>> = [];

  class Query {
    private mode: "read" | "update" | "delete" = "read";
    private statusFilter: string[] | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    in(column: string, values: string[]) {
      if (column === "status") this.statusFilter = values;
      return this;
    }

    limit() {
      return this;
    }

    update(values: Record<string, unknown>) {
      this.mode = "update";
      if (this.table === "checkout_locks") lockUpdates.push(values);
      return this;
    }

    delete() {
      this.mode = "delete";
      if (this.table === "checkout_locks") lockDeletes.push(this.table);
      return this;
    }

    async insert(values: Record<string, unknown>) {
      if (this.table === "orders") orderInserts.push(values);
      return { error: null };
    }

    maybeSingle() {
      return Promise.resolve(this.evaluate(true));
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(this.evaluate(false)).then(onfulfilled, onrejected);
    }

    private evaluate(single: boolean) {
      if (this.mode === "delete") return { data: null, error: null };
      if (this.mode === "update") {
        return {
          data: single && this.table === "checkout_locks" ? { lock_key: "buyer__course" } : null,
          error: null,
        };
      }

      const candidate = this.table === "enrollments"
        ? input.enrollment ?? null
        : this.table === "course_subscriptions"
          ? input.subscription ?? null
          : null;
      const row = candidate && (!this.statusFilter || this.statusFilter.includes(candidate.status))
        ? candidate
        : null;
      return { data: single ? row : row ? [row] : [], error: null };
    }
  }

  const admin = {
    from: vi.fn((table: string) => new Query(table)),
    rpc: vi.fn(async (name: string, params?: Record<string, unknown>) => {
      if (!params) throw new Error(`Missing params for rpc: ${name}`);
      if (name === "enforce_rate_limit") {
        return { data: true, error: null };
      }
      if (name !== "claim_checkout_lock") {
        throw new Error(`Unexpected rpc: ${name}`);
      }
      const reply = lockReplies.shift();
      return {
        data: reply ? [reply] : null,
        error: reply ? null : { message: "Missing lock reply" },
      };
    }),
    lockUpdates,
    lockDeletes,
    orderInserts,
  };

  return admin;
}

function course(paymentType = "subscription_monthly") {
  return {
    id: "course",
    owner_id: "teacher",
    title: "Clinical Foundations",
    summary: "A course",
    status: "published",
    payment_type: paymentType,
    price_amount_minor: 12_000,
    currency: "USD",
    stripe_connected_account_id: "acct_teacher",
    installments_enabled: false,
    installments_max: null,
    cover_image_url: null,
  };
}

describe("course checkout subscription exclusivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("buyer");
    mocks.getCourseRow.mockResolvedValue(course());
    mocks.getUserRow.mockImplementation(async (id: string) => id === "teacher"
      ? {
          uid: "teacher",
          current_plan_id: "professional",
          stripe_connected_account_id: "acct_teacher",
          stripe_connect_charges_enabled: true,
          stripe_connect_payouts_enabled: true,
        }
      : { uid: "buyer", email: "buyer@example.com" });
    mocks.loadOffers.mockResolvedValue([]);
    mocks.normalizePrice.mockImplementation(
      (_course: unknown, _offers: unknown, selection: { offerId?: string; priceId?: string }) => ({
        amountMinor: 12_000,
        currency: "usd",
        paymentType: "subscription_monthly",
        source: selection.offerId ? "offer" : "legacy",
        offerId: selection.offerId,
        priceId: selection.priceId,
        stripePriceId: selection.priceId ? `stripe_${selection.priceId}` : null,
      }),
    );
    mocks.getCustomer.mockResolvedValue("cus_buyer");
    mocks.getSubscriptionPrice.mockResolvedValue("price_subscription");
    mocks.createSession.mockResolvedValue({
      id: "cs_subscription",
      url: "https://checkout.example/subscription",
    });
    mocks.expireSession.mockResolvedValue({ id: "cs_subscription", status: "expired" });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create: mocks.createSession,
          expire: mocks.expireSession,
        },
      },
    });
  });

  it("blocks a second subscription when a non-terminal subscription already exists", async () => {
    const admin = createAdmin({ subscription: { id: "sub_active", status: "active" } });
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "You already have a subscription for this course.",
    });
    expect(admin.rpc.mock.calls.filter(([name]) => name === "claim_checkout_lock")).toHaveLength(0);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("keeps the existing enrollment guard before opening a subscription checkout", async () => {
    const admin = createAdmin({ enrollment: { status: "active" } });
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(409);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("reuses one persistent buyer-course checkout across offers", async () => {
    const admin = createAdmin({
      lockReplies: [
        { action: "claim", checkout_url: null },
        { action: "reuse", checkout_url: "https://checkout.example/subscription" },
      ],
    });
    mocks.getAdmin.mockReturnValue(admin);

    const first = await POST(request({
      courseId: "course",
      offerId: "offer-monthly",
      priceId: "price-monthly",
    }));
    const second = await POST(request({
      courseId: "course",
      offerId: "offer-yearly",
      priceId: "price-yearly",
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ url: "https://checkout.example/subscription" });
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    const lockCalls = admin.rpc.mock.calls.filter(([name]) => name === "claim_checkout_lock");
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls[0]).toEqual([
      "claim_checkout_lock",
      expect.objectContaining({ p_user_id: "buyer", p_course_id: "course" }),
    ]);
    expect(admin.rpc).toHaveBeenCalledWith("enforce_rate_limit", {
      p_key: "checkout_buyer",
      p_limit: 10,
      p_window_ms: 60 * 60 * 1000,
    });
    expect(lockCalls[0][1]).toEqual(
      expect.objectContaining({
        p_session_ttl_ms: 35 * 60 * 1000,
        p_claim_grace_ms: 35 * 60 * 1000,
      }),
    );
    const [, idempotency] = mocks.createSession.mock.calls[0];
    expect(idempotency.idempotencyKey).not.toContain("offer-monthly");
    expect(idempotency.idempotencyKey).not.toContain("price-monthly");
    expect(mocks.createSession.mock.calls[0][0]).toEqual(
      expect.objectContaining({ mode: "subscription", expires_at: expect.any(Number) }),
    );
    expect(admin.lockUpdates).toEqual([
      expect.objectContaining({
        checkout_url: "https://checkout.example/subscription",
        checkout_session_id: "cs_subscription",
      }),
    ]);
  });

  it("leaves the one-time checkout path intact", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
    });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.getCourseRow.mockResolvedValue(course("one_time"));
    mocks.normalizePrice.mockReturnValue({
      amountMinor: 12_000,
      currency: "usd",
      paymentType: "one_time",
      source: "legacy",
    });
    mocks.createSession.mockResolvedValue({
      id: "cs_payment",
      url: "https://checkout.example/payment",
    });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.example/payment" });
    expect(mocks.createSession.mock.calls[0][0]).toEqual(
      expect.objectContaining({ mode: "payment" }),
    );
    expect(admin.orderInserts).toHaveLength(1);
  });

  it("preserves the lock when Stripe may have created a session before losing the response", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
    });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.createSession.mockRejectedValueOnce(new Error("connection lost after request"));

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(500);
    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(admin.lockDeletes).toEqual([]);
  });
});

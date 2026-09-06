import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getLocale: vi.fn(),
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
  retrieveSession: vi.fn(),
  getPercentOffCoupon: vi.fn(),
}));

vi.mock("@/lib/i18n/server", () => ({ getServerLocale: mocks.getLocale }));

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
  getStripeAccountCountry: vi.fn(async () => null),
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
  getOrCreateAccountPercentOffCoupon: mocks.getPercentOffCoupon,
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

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "coupon_row",
    course_id: "course",
    owner_id: "teacher",
    code: "LAUNCH25",
    percent_off: 25,
    max_redemptions: 100,
    redeemed_count: 0,
    expires_at: null,
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createAdmin(input: {
  enrollment?: ExistingRow;
  subscription?: ExistingRow;
  lockReplies?: LockReply[];
  coupon?: Record<string, unknown> | null;
  checkoutLock?: Record<string, unknown> | null;
  existingOrder?: Record<string, unknown> | null;
  orderVanished?: boolean;
  lockPublishLost?: boolean;
}) {
  const lockReplies = [...(input.lockReplies ?? [])];
  const lockUpdates: Array<Record<string, unknown>> = [];
  const lockDeletes: string[] = [];
  const orderInserts: Array<Record<string, unknown>> = [];

  class Query {
    private mode: "read" | "update" | "delete" = "read";
    private statusFilter: string[] | null = null;
    private equals = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.equals.set(column, value);
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
        if (!single) return { data: null, error: null };
        if (this.table === "checkout_locks") {
          const ownsClaim = this.equals.has("order_id");
          return {
            data: input.lockPublishLost && ownsClaim ? null : { lock_key: "buyer__course" },
            error: null,
          };
        }
        if (this.table === "orders") {
          return { data: input.orderVanished ? null : { id: "order" }, error: null };
        }
        return { data: null, error: null };
      }

      if (this.table === "course_coupons") {
        const couponRow = input.coupon ?? null;
        return { data: single ? couponRow : couponRow ? [couponRow] : [], error: null };
      }

      if (this.table === "checkout_locks") {
        const lockRow = input.checkoutLock ?? null;
        return { data: single ? lockRow : lockRow ? [lockRow] : [], error: null };
      }

      if (this.table === "orders") {
        const orderRow = input.existingOrder ?? null;
        return { data: single ? orderRow : orderRow ? [orderRow] : [], error: null };
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
      if (name === "reserve_course_coupon" || name === "release_course_coupon_reservation") {
        return { data: null, error: null };
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
    mocks.getLocale.mockResolvedValue("en");
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
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_subscription",
      metadata: { offerId: "offer-monthly", priceId: "price-monthly" },
    });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create: mocks.createSession,
          expire: mocks.expireSession,
          retrieve: mocks.retrieveSession,
        },
      },
    });
  });

  it("pins the selected currency instead of accepting a cached Price's other currency options", async () => {
    const admin = createAdmin({ lockReplies: [{ action: "claim", checkout_url: null }] });
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(200);
    expect(mocks.createSession.mock.calls[0][0].currency).toBe("usd");
  });

  it.each([
    ["acct_other_creator", 409],
    [null, 409],
    ["acct_teacher", 200],
  ])("checks the frozen account %s before reusing a one-time checkout", async (frozenAccount, expectedStatus) => {
    const checkoutUrl = "https://checkout.example/existing-one-time";
    const admin = createAdmin({
      lockReplies: [{ action: "reuse", checkout_url: checkoutUrl }],
      checkoutLock: { order_id: "order_previous" },
      existingOrder: { offer_id: null, price_id: null, teacher_stripe_connected_account_id: frozenAccount },
    });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.getCourseRow.mockResolvedValue(course("one_time"));
    mocks.normalizePrice.mockReturnValue({ amountMinor: 12_000, currency: "usd", paymentType: "one_time", source: "legacy" });

    const response = await POST(request({ courseId: "course" }));
    const body = await response.json();

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) expect(body.url).toBe(checkoutUrl);
    else expect(body).not.toHaveProperty("url");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(mocks.retrieveSession).not.toHaveBeenCalled();
  });

  it.each(["one_time", "subscription_monthly"])("charges the owner's account despite a foreign account cached on the %s course", async (paymentType) => {
    const admin = createAdmin({ lockReplies: [{ action: "claim", checkout_url: null }] });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.getCourseRow.mockResolvedValue({ ...course(paymentType), stripe_connected_account_id: "acct_another_creator" });
    mocks.normalizePrice.mockReturnValue({ amountMinor: 12_000, currency: "usd", paymentType, source: "legacy" });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(200);
    expect(mocks.createSession.mock.calls[0][1].stripeAccount).toBe("acct_teacher");
    if (paymentType === "one_time") {
      expect(admin.orderInserts[0].teacher_stripe_connected_account_id).toBe("acct_teacher");
    } else {
      expect(mocks.getSubscriptionPrice.mock.calls[0].at(-1)).toBe("acct_teacher");
    }
  });

  it.each(["missing_owner", "missing_account", "charges_disabled", "payouts_disabled"])("refuses a foreign course account bypass when the owner is %s", async (ownerState) => {
    const admin = createAdmin({ lockReplies: [{ action: "claim", checkout_url: null }] });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.getCourseRow.mockResolvedValue({ ...course(), stripe_connected_account_id: "acct_another_creator" });
    mocks.getUserRow.mockImplementation(async (id: string) => id !== "teacher"
      ? { uid: "buyer", email: "buyer@example.com" }
      : ownerState === "missing_owner" ? null : {
        uid: "teacher", current_plan_id: "free",
        stripe_connected_account_id: ownerState === "missing_account" ? null : "acct_teacher",
        stripe_connect_charges_enabled: ownerState !== "charges_disabled",
        stripe_connect_payouts_enabled: ownerState !== "payouts_disabled",
      });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.getSubscriptionPrice).not.toHaveBeenCalled();
    expect(admin.orderInserts).toEqual([]);
  });

  it.each([
    ["en", "one_time", "payment"], ["es", "one_time", "payment"],
    ["en", "subscription_monthly", "subscription"], ["es", "subscription_monthly", "subscription"],
  ])("passes request locale %s to Stripe for %s", async (locale, paymentType, mode) => {
    mocks.getLocale.mockResolvedValue(locale);
    mocks.getAdmin.mockReturnValue(createAdmin({ lockReplies: [{ action: "claim", checkout_url: null }] }));
    mocks.getCourseRow.mockResolvedValue(course(paymentType));
    mocks.normalizePrice.mockReturnValue({ amountMinor: 12000, currency: "usd", paymentType, source: "legacy" });
    expect((await POST(request({ courseId: "course" }))).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ locale, mode }),
      expect.objectContaining({ stripeAccount: "acct_teacher" }),
    );
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

  it("reuses one persistent buyer-course checkout for the same offer", async () => {
    const admin = createAdmin({
      lockReplies: [
        { action: "claim", checkout_url: null },
        { action: "reuse", checkout_url: "https://checkout.example/subscription" },
      ],
      checkoutLock: { checkout_session_id: "cs_subscription" },
    });
    mocks.getAdmin.mockReturnValue(admin);

    const body = { courseId: "course", offerId: "offer-monthly", priceId: "price-monthly" };
    const first = await POST(request(body));
    const second = await POST(request(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ url: "https://checkout.example/subscription" });
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.retrieveSession).toHaveBeenCalledWith("cs_subscription", undefined, {
      stripeAccount: "acct_teacher",
    });
  });

  it("blocks a reused subscription checkout when the buyer switched offers", async () => {
    const admin = createAdmin({
      lockReplies: [
        { action: "claim", checkout_url: null },
        { action: "reuse", checkout_url: "https://checkout.example/subscription" },
      ],
      checkoutLock: { checkout_session_id: "cs_subscription" },
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
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error:
        "Another offer already has an active checkout. Close it or wait for it to expire before switching offers.",
    });
    // The lock still stays one-per-buyer-per-course: the second attempt is
    // refused, never given a second Stripe session.
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

  it("mints the recurring price at list value and puts the coupon on the session", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
      coupon: coupon(),
    });
    mocks.getAdmin.mockReturnValue(admin);
    mocks.getPercentOffCoupon.mockResolvedValue("skillset_pct_25_once");

    const response = await POST(request({ courseId: "course", couponCode: "launch25" }));

    expect(response.status).toBe(200);

    // The double-discount guard: a 25% coupon must NOT shrink the recurring
    // Price. Baking it in here plus the Stripe coupon on the first invoice
    // would discount twice, and the Price cut would never expire.
    expect(mocks.getSubscriptionPrice.mock.calls[0][3]).toBe(12_000);

    expect(mocks.getPercentOffCoupon).toHaveBeenCalledWith(
      expect.anything(),
      25,
      "acct_teacher",
    );

    const params = mocks.createSession.mock.calls[0][0];
    expect(params.discounts).toEqual([{ coupon: "skillset_pct_25_once" }]);

    // No order row exists for a subscription, so the reservation is keyed by
    // the attempt id — and the webhook can only finalize what it can read off
    // the subscription metadata.
    const [, reserveParams] = admin.rpc.mock.calls.find(
      ([name]) => name === "reserve_course_coupon",
    )!;
    expect(params.subscription_data.metadata.couponReservationId).toBe(
      (reserveParams as { p_order_id: string }).p_order_id,
    );
    expect(params.subscription_data.metadata.couponCode).toBe("LAUNCH25");
  });

  it("still discounts the charge itself on the one-time path", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
      coupon: coupon(),
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

    const response = await POST(request({ courseId: "course", couponCode: "LAUNCH25" }));

    expect(response.status).toBe(200);
    expect(admin.orderInserts[0]).toEqual(
      expect.objectContaining({ amount_minor: 9_000, coupon_code: "LAUNCH25" }),
    );
    // One-time carries no Stripe coupon: the discount is already the charge.
    expect(mocks.getPercentOffCoupon).not.toHaveBeenCalled();
    expect(mocks.createSession.mock.calls[0][0].discounts).toBeUndefined();
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

  it("expires the session and frees the lock when the one-time path fails after create", async () => {
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
    // Session exists on the connected account but is unusable, so nobody can
    // ever pay it — the lock must not outlive it.
    mocks.createSession.mockResolvedValue({ id: "cs_no_url", url: null });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(500);
    expect(mocks.expireSession).toHaveBeenCalledWith(
      "cs_no_url",
      {},
      { stripeAccount: "acct_teacher" },
    );
    expect(admin.lockDeletes).toEqual(["checkout_locks"]);
  });

  it("refuses to hand out a session whose order never took the session id", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
      // A zero-row UPDATE is a silent success in PostgREST. Without the row
      // check the buyer gets a payable url and fulfillment finds no order.
      orderVanished: true,
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
      id: "cs_orphan",
      url: "https://checkout.example/payment",
    });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(500);
    expect(mocks.expireSession).toHaveBeenCalledWith(
      "cs_orphan",
      {},
      { stripeAccount: "acct_teacher" },
    );
    expect(admin.lockDeletes).toEqual(["checkout_locks"]);
  });

  it("expires a late session when another request has taken over its lock", async () => {
    const admin = createAdmin({
      lockReplies: [{ action: "claim", checkout_url: null }],
      lockPublishLost: true,
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
      id: "cs_late",
      url: "https://checkout.example/late",
    });

    const response = await POST(request({ courseId: "course" }));

    expect(response.status).toBe(500);
    expect(mocks.expireSession).toHaveBeenCalledWith(
      "cs_late",
      {},
      { stripeAccount: "acct_teacher" },
    );
    // The delete is owner-scoped too; it cannot remove the newer request's lock.
    expect(admin.lockDeletes).toEqual(["checkout_locks"]);
  });
});

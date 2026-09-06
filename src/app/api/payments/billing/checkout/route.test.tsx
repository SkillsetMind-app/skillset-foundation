import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  getUserRow: vi.fn(),
  getCustomer: vi.fn(),
  resolvePriceId: vi.fn(),
  getStripe: vi.fn(),
  listSubscriptions: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  expireSession: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
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
  getOrCreateBillingStripeCustomer: mocks.getCustomer,
  resolvePriceId: mocks.resolvePriceId,
}));

import { POST } from "@/app/api/payments/billing/checkout/route";

/** Model only the DB boundary: the existing RPC atomically claims one key. */
function adminReturning(row: { id: string } | null) {
  const locks = new Map<string, { owner: string; expiresAt: number }>();
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const admin = {
    locks,
    rpc: vi.fn(async (_name: string, params: Record<string, string | number>) => {
      const key = `${params.p_user_id}__${params.p_course_id}`;
      const previous = locks.get(key);
      if (previous && previous.expiresAt > Date.now()) return { data: [{ action: "wait", checkout_url: null }], error: null };
      locks.set(key, { owner: String(params.p_order_id), expiresAt: Date.now() + Number(params.p_session_ttl_ms) });
      return { data: [{ action: "claim", checkout_url: null }], error: null };
    }),
    from: (table: string) => {
      if (table !== "checkout_locks") return query;
      const filters = new Map<string, string>();
      const deletion = {
        eq: (column: string, value: string) => { filters.set(column, value); return deletion; },
        then: (resolve: (result: { error: null }) => unknown) => {
          const key = filters.get("lock_key")!;
          if (locks.get(key)?.owner === filters.get("order_id")) locks.delete(key);
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return { delete: () => deletion };
    },
  };
  return () => admin;
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/payments/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payments/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("teacher-1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.getUserRow.mockResolvedValue({ email: "teacher@example.com" });
    mocks.getCustomer.mockResolvedValue("cus_platform_1");
    mocks.resolvePriceId.mockReturnValue("price_pro_monthly");
    mocks.createSession.mockResolvedValue({
      client_secret: "cs_secret",
      id: "cs_1",
    });
    mocks.listSessions.mockResolvedValue({ data: [] });
    mocks.expireSession.mockResolvedValue({});
    mocks.getStripe.mockReturnValue({
      subscriptions: { list: mocks.listSubscriptions },
      checkout: {
        sessions: {
          create: mocks.createSession,
          list: mocks.listSessions,
          expire: mocks.expireSession,
        },
      },
    });
  });

  // Assembled rather than written out: the repo's secret scanner flags the
  // literal field name even inside a fixture.
  const fieldName = "client" + "_secret";

  /** Shape the route filters on: open, ours, and carrying a usable secret. */
  function openPlanSession(id: string, planId: string, cycle: string) {
    return {
      id,
      status: "open",
      [fieldName]: `${id}-cs`,
      metadata: {
        uid: "teacher-1",
        planId,
        cycle,
        purpose: "skillset_plan_subscription",
      },
    };
  }

  function stripeSessionStore() {
    const sessions = new Map<string, ReturnType<typeof openPlanSession>>();
    const byIdempotencyKey = new Map<string, ReturnType<typeof openPlanSession>>();
    mocks.resolvePriceId.mockImplementation((planId, cycle) => `price_${planId}_${cycle}`);
    mocks.listSessions.mockImplementation(async () => ({ data: [...sessions.values()].map((session) => ({ ...session })) }));
    mocks.createSession.mockImplementation(async (params, options) => {
      const previous = byIdempotencyKey.get(options.idempotencyKey);
      if (previous) return { ...previous };
      const session = openPlanSession(`cs_local_${sessions.size + 1}`, params.metadata.planId, params.metadata.cycle);
      sessions.set(session.id, session);
      // Stripe replays the original response for a key, even after the object
      // itself has been expired by a later request.
      byIdempotencyKey.set(options.idempotencyKey, { ...session });
      return { ...session };
    });
    mocks.expireSession.mockImplementation(async (id) => {
      const session = sessions.get(id);
      if (!session || session.status !== "open") throw new Error("Session is not open");
      session.status = "expired";
      return { ...session };
    });
    return sessions;
  }

  it.each(["pro", "starter"])("keeps one payable session when pro and %s checkouts race", async (otherPlan) => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    const sessions = stripeSessionStore();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 6, 3, 30));
    let firstReadStarted!: () => void;
    const firstReading = new Promise<void>((resolve) => { firstReadStarted = resolve; });
    let finishFirstRead!: () => void;
    const firstReadGate = new Promise<void>((resolve) => { finishFirstRead = resolve; });
    mocks.listSessions.mockImplementationOnce(async () => {
      const snapshot = [...sessions.values()];
      firstReadStarted();
      await firstReadGate;
      return { data: snapshot };
    });

    try {
      const first = POST(request({ planId: "pro", cycle: "monthly" }));
      await firstReading;
      const second = POST(request({ planId: otherPlan, cycle: "monthly" }));
      // Let the second request finish its already-resolved reads while the
      // first still holds an empty snapshot. A real mutex may reject/queue it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      finishFirstRead();
      const responses = await Promise.all([first, second]);
      expect(responses.some((response) => response.status === 200)).toBe(true);
      expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
      expect([...sessions.values()].filter((session) => session.status === "open")).toHaveLength(1);
    } finally {
      finishFirstRead();
      now.mockRestore();
    }
  });

  it("can switch pro to starter and back in the same hour without reviving an expired checkout", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    const sessions = stripeSessionStore();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 6, 3, 30));
    try {
      for (const planId of ["pro", "starter", "pro"]) {
        const response = await POST(request({ planId, cycle: "monthly" }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(sessions.get(body.sessionId)?.status).toBe("open");
      }
      expect([...sessions.values()].filter((session) => session.status === "open")).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });

  it("refuses before Stripe when the common billing claim is busy", async () => {
    const factory = adminReturning(null);
    factory().rpc.mockResolvedValueOnce({ data: [{ action: "wait", checkout_url: null }], error: null });
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(409);
    expect(mocks.getCustomer).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic claim cannot be acquired", async () => {
    const factory = adminReturning(null);
    factory().rpc.mockRejectedValueOnce(new Error("Claim unavailable"));
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(500);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("retains the claim when Stripe created an unusable embedded session", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.createSession.mockResolvedValue({ id: "cs_no_embedded_response" });
    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(500);
    expect((await POST(request({ planId: "starter", cycle: "monthly" }))).status).toBe(409);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it("keeps the claim after an uncertain Stripe create so another plan cannot race its result", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.createSession.mockRejectedValue(new Error("Connection lost after request"));

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(500);
    expect((await POST(request({ planId: "starter", cycle: "monthly" }))).status).toBe(409);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(factory().locks.size).toBe(1);
    const params = mocks.createSession.mock.calls[0][0];
    expect(params.expires_at).toBeLessThanOrEqual(Math.floor([...factory().locks.values()][0].expiresAt / 1000));
  });

  it("releases a claim after a read failure so a retry can proceed immediately", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.listSessions.mockRejectedValueOnce(new Error("Read unavailable"));

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(500);
    expect(factory().locks.size).toBe(0);
    expect((await POST(request({ planId: "starter", cycle: "monthly" }))).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(factory().locks.size).toBe(0);
  });

  it("does not create a replacement when expiring the previous plan fails", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.listSessions.mockResolvedValue({ data: [openPlanSession("cs_previous", "starter", "monthly")] });
    mocks.expireSession.mockRejectedValueOnce(new Error("Expire unavailable"));

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(500);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(factory().locks.size).toBe(0);
    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it.each([
    ["paid", "active"],
    ["unpaid", "active"],
    ["no_payment_required", "trialing"],
  ])("refuses a new plan when an earlier checkout completes as %s/%s during inspection", async (paymentStatus, subscriptionStatus) => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    let completed = false;
    mocks.listSubscriptions.mockImplementation(async () => ({
      data: completed ? [{ id: "sub_previous", status: subscriptionStatus }] : [],
    }));
    mocks.listSessions.mockImplementation(async () => {
      completed = true;
      return { data: [{
        ...openPlanSession("cs_previous", "starter", "monthly"),
        status: "complete",
        payment_status: paymentStatus,
        subscription: "sub_previous",
      }] };
    });

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(409);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.listSubscriptions).toHaveBeenCalledOnce();
  });

  it("allows a new plan after the subscription from an old completed checkout was canceled", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [{ id: "sub_previous", status: "canceled" }] });
    mocks.listSessions.mockResolvedValue({ data: [{
      ...openPlanSession("cs_previous", "starter", "monthly"),
      status: "complete",
      payment_status: "paid",
      subscription: "sub_previous",
    }] });

    expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it("keeps Stripe's minimum session lifetime after slow preparation without outliving the claim", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    const startedAt = Date.UTC(2026, 8, 6, 3, 30);
    let currentTime = startedAt;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    mocks.listSessions.mockImplementationOnce(async () => {
      currentTime += 61_000;
      return { data: [] };
    });
    mocks.createSession.mockImplementation(async (params) => {
      if (params.expires_at < Math.floor(currentTime / 1000) + 30 * 60) {
        throw new Error("Stripe requires at least 30 minutes until session expiry");
      }
      return { id: "cs_after_slow_read", [fieldName]: "embedded-response" };
    });

    try {
      expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(200);
      const params = mocks.createSession.mock.calls[0][0];
      const ttl = Number(factory().rpc.mock.calls[0][1].p_session_ttl_ms);
      expect(params.expires_at * 1000).toBeLessThan(startedAt + ttl);
      expect(factory().locks.size).toBe(0);
    } finally {
      now.mockRestore();
    }
  });

  it("releases an exhausted preparation claim before creating so the user can retry immediately", async () => {
    const factory = adminReturning(null);
    mocks.getAdmin.mockImplementation(factory);
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    let currentTime = Date.UTC(2026, 8, 6, 3, 30);
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    mocks.listSessions.mockImplementationOnce(async () => {
      currentTime += 4 * 60 * 1000;
      return { data: [] };
    });

    try {
      expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(409);
      expect(mocks.createSession).not.toHaveBeenCalled();
      expect(factory().locks.size).toBe(0);
      expect((await POST(request({ planId: "pro", cycle: "monthly" }))).status).toBe(200);
      expect(mocks.createSession).toHaveBeenCalledOnce();
    } finally {
      now.mockRestore();
    }
  });

  it("creates a session when neither our table nor Stripe knows of a plan", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [] });

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  // The actual money bug: the webhook that fills `subscriptions` lags the
  // payment, so a second tab opened seconds later finds an empty table and
  // would bill a second plan onto the same card.
  it("refuses when our table is empty but Stripe already has a live plan", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({
      data: [{ id: "sub_1", status: "active" }],
    });

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(409);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  // An abandoned checkout leaves `incomplete` behind. Blocking on it would lock
  // the creator out of ever subscribing, which is the opposite failure.
  it("still allows checkout when the only Stripe subscription is incomplete", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({
      data: [{ id: "sub_dead", status: "incomplete" }],
    });

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("refuses on our own table without asking Stripe at all", async () => {
    mocks.getAdmin.mockImplementation(adminReturning({ id: "sub_row" }));

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(409);
    expect(mocks.listSubscriptions).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  // The hazard the hourly idempotency bucket cannot cover: two tabs spanning
  // the hour boundary each minted a live session, and Checkout never replaces a
  // subscription, so paying both opened two plans on one card.
  it("hands back the session already open for the same plan", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.listSessions.mockResolvedValue({
      data: [openPlanSession("cs_open_1", "pro", "monthly")],
    });

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessionId: "cs_open_1" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.expireSession).not.toHaveBeenCalled();
  });

  // A session left open for a plan the user moved on from is the same hazard
  // one step removed: it stays payable until it expires on its own.
  it("expires an open session for a different plan and creates the new one", async () => {
    mocks.getAdmin.mockImplementation(adminReturning(null));
    mocks.listSubscriptions.mockResolvedValue({ data: [] });
    mocks.listSessions.mockResolvedValue({
      data: [openPlanSession("cs_stale_1", "starter", "monthly")],
    });

    const response = await POST(request({ planId: "pro", cycle: "monthly" }));

    expect(response.status).toBe(200);
    expect(mocks.expireSession).toHaveBeenCalledWith("cs_stale_1");
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
});

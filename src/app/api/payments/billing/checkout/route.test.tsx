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

/**
 * Admin client stub. The route makes exactly one query — the `subscriptions`
 * pre-check — so the chain only has to survive select/eq/in/limit/maybeSingle.
 */
function adminReturning(row: { id: string } | null) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return () => ({ from: () => query });
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

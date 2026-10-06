import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: () => ({ subscriptions: { retrieve: mocks.retrieve, update: mocks.update } }),
}));

import { GET, POST } from "@/app/api/payments/billing/subscription/route";

const trialing = {
  id: "sub_plan_1",
  plan_id: "pro",
  cycle: "monthly",
  status: "trialing",
  trial_end: "2026-10-20T12:00:00.000Z",
  current_period_end: "2026-10-20T12:00:00.000Z",
  cancel_at_period_end: false,
};

function admin(subscription: Record<string, unknown> | null, pastTrial: Record<string, unknown> | null) {
  const writes: Array<Record<string, unknown>> = [];
  const chain = (data: unknown) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      update: (values: Record<string, unknown>) => {
        writes.push(values);
        return query;
      },
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return query;
  };
  return {
    writes,
    from: (table: string) => chain(table === "creator_plan_trials" ? pastTrial : subscription),
  };
}

describe("/api/payments/billing/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("creator_1");
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.retrieve.mockResolvedValue({ id: "sub_plan_1", metadata: { uid: "creator_1" } });
    mocks.update.mockResolvedValue({ id: "sub_plan_1", status: "trialing", cancel_at_period_end: true });
  });

  it("reports the trial end while trialing, and that the trial is used", async () => {
    mocks.getAdmin.mockReturnValue(admin(trialing, { user_id: "creator_1" }));

    const body = await (await GET()).json();

    expect(body).toEqual({
      trialEligible: false,
      subscription: {
        planId: "pro",
        cycle: "monthly",
        status: "trialing",
        trialEnd: "2026-10-20T12:00:00.000Z",
        currentPeriodEnd: "2026-10-20T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
    });
  });

  it("offers the trial to an account that never had one", async () => {
    mocks.getAdmin.mockReturnValue(admin(null, null));
    expect(await (await GET()).json()).toEqual({ trialEligible: true, subscription: null });
  });

  it("cancels at period end: during the trial that means no charge at all", async () => {
    const db = admin(trialing, { user_id: "creator_1" });
    mocks.getAdmin.mockReturnValue(db);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("sub_plan_1", { cancel_at_period_end: true });
    expect(db.writes[0]).toMatchObject({ cancel_at_period_end: true });
    expect((await response.json()).subscription).toMatchObject({
      status: "trialing",
      trialEnd: "2026-10-20T12:00:00.000Z",
      cancelAtPeriodEnd: true,
    });
  });

  it("answers 404 when there is no live plan to cancel", async () => {
    mocks.getAdmin.mockReturnValue(admin(null, null));
    expect((await POST()).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses a subscription whose Stripe owner is someone else", async () => {
    mocks.getAdmin.mockReturnValue(admin(trialing, null));
    mocks.retrieve.mockResolvedValue({ id: "sub_plan_1", metadata: { uid: "someone_else" } });
    expect((await POST()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

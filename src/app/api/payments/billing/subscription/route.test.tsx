import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
  enforceRateLimit: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/stripe")>()),
  getStripeClient: () => ({ invoices: { createPreview: mocks.preview }, subscriptions: { retrieve: mocks.retrieve, update: mocks.update, cancel: mocks.cancel } }),
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
    mocks.preview.mockResolvedValue({ amount_due: 8900, currency: "usd" });
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
        nextPayment: { amountMinor: 8900, currency: "usd" },
        contractedPrice: null,
      },
    });
  });

  it("offers the trial to an account that never had one", async () => {
    mocks.getAdmin.mockReturnValue(admin(null, null));
    expect(await (await GET()).json()).toEqual({ trialEligible: true, subscription: null });
  });

  it.each([500, 5000, 900, 9000, 0, 350])("returns Stripe's actual next payment %s, not catalog pricing", async (amount) => {
    const db = admin({ ...trialing, plan_id: "basic" }, null);
    mocks.getAdmin.mockReturnValue(db);
    mocks.preview.mockResolvedValue({ amount_due: amount, currency: "usd" });
    expect((await (await GET()).json()).subscription.nextPayment).toEqual({ amountMinor: amount, currency: "usd" });
    expect(mocks.preview).toHaveBeenCalledWith({ subscription: trialing.id });
    expect(db.writes).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps cancellation available when the preview fails, without guessing an amount", async () => {
    mocks.getAdmin.mockReturnValue(admin(trialing, null));
    mocks.preview.mockRejectedValue(new Error("unavailable"));
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).subscription.nextPayment).toBeNull();
  });

  it.each([{ amount_due: -1, currency: "usd" }, { amount_due: 500.5, currency: "usd" }, { amount_due: 500, currency: "invalid" }])("does not display invalid preview data %j", async (invoice) => {
    mocks.getAdmin.mockReturnValue(admin(trialing, null));
    mocks.preview.mockResolvedValue(invoice);
    expect((await (await GET()).json()).subscription.nextPayment).toBeNull();
  });

  it("does not preview a cancelled renewal", async () => {
    mocks.getAdmin.mockReturnValue(admin({ ...trialing, cancel_at_period_end: true }, null));
    expect((await (await GET()).json()).subscription.nextPayment).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it.each([
    ["price_1UP4MvPvg1vJW0IjLNG6YeC9", 500, "monthly"],
    ["price_1UP4MwPvg1vJW0IjKAq6kpd8", 5000, "yearly"],
    ["price_1UVi6QPvg1vJW0IjKHYmUE09", 900, "monthly"],
    ["price_1UVi6RPvg1vJW0Ijz87nmj5D", 9000, "yearly"],
  ])("keeps contracted tariff %s even without a preview", async (id, amount, cycle) => {
    mocks.getAdmin.mockReturnValue(admin({ ...trialing, stripe_price_id: id }, null));
    mocks.preview.mockRejectedValue(new Error("unavailable"));
    expect((await (await GET()).json()).subscription).toMatchObject({
      contractedPrice: { amountMinor: amount, currency: "usd", cycle }, nextPayment: null,
    });
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

  // Cancel at period end would leave Stripe retrying the open invoice, so the
  // creator could still be charged after clicking Cancel.
  it.each(["past_due", "unpaid"])("cancels a %s plan at once, so Stripe stops retrying", async (status) => {
    const db = admin({ ...trialing, status, trial_end: null }, { user_id: "creator_1" });
    mocks.getAdmin.mockReturnValue(db);
    mocks.retrieve.mockResolvedValue({ id: "sub_plan_1", status, metadata: { uid: "creator_1" } });
    mocks.cancel.mockResolvedValue({ id: "sub_plan_1", status: "canceled" });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith("sub_plan_1");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(db.writes[0]).toMatchObject({ status: "canceled" });
    expect((await response.json()).subscription).toBeNull();
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

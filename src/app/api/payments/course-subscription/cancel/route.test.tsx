import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  requireUserId: vi.fn(),
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/payments/server/auth")
  >();
  return {
    ...actual,
    enforceRateLimit: mocks.enforceRateLimit,
    requireUserId: mocks.requireUserId,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/stripe", () => ({
  getStripeClient: mocks.getStripe,
}));

import { POST } from "@/app/api/payments/course-subscription/cancel/route";

// The frozen sale-time account (orders) and the live one (courses) are read
// separately, so each test can make them disagree.
let orderSnapshot: { teacher_stripe_connected_account_id: string } | null;
let courseRow: {
  stripe_connected_account_id: string | null;
  owner_id?: string;
} | null;

// orders is queried as .select().eq().eq().eq().not().order().limit()
// .maybeSingle() — one self-returning object covers the whole chain.
function ordersQuery() {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: orderSnapshot }),
  };
  for (const method of ["select", "eq", "not", "order", "limit"]) {
    chain[method] = () => chain;
  }
  return chain;
}

describe("course subscription cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderSnapshot = null;
    courseRow = { stripe_connected_account_id: "acct_teacher" };
    mocks.requireUserId.mockResolvedValue("user_1");
    mocks.retrieve.mockResolvedValue({
      metadata: { purpose: "course_subscription", userId: "user_1" },
    });
    mocks.update.mockResolvedValue({
      items: { data: [{ current_period_end: 1_800_000_000 }] },
      status: "active",
    });
    mocks.getStripe.mockReturnValue({
      subscriptions: { retrieve: mocks.retrieve, update: mocks.update },
    });

    const mirrorEq = vi.fn().mockResolvedValue({ error: null });
    mocks.getAdmin.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "enrollments") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { subscription_id: "sub_1" } }),
              }),
            }),
          };
        }
        if (table === "courses") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: courseRow }),
              }),
            }),
          };
        }
        if (table === "orders") {
          return ordersQuery();
        }
        return { update: () => ({ eq: mirrorEq }) };
      }),
    });
  });

  it("scopes both Stripe calls to the teacher account", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments/course-subscription/cancel", {
        method: "POST",
        body: JSON.stringify({ courseId: "course_1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_1", undefined, {
      stripeAccount: "acct_teacher",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true },
      { stripeAccount: "acct_teacher" },
    );
  });

  it("uses the frozen sale-time account when the teacher reconnected a new one", async () => {
    // The subscription still lives on acct_old; the course now points at the
    // account connect-self-heal minted. Cancelling against acct_new would 404
    // and the learner would keep being billed.
    orderSnapshot = { teacher_stripe_connected_account_id: "acct_old" };
    courseRow = { stripe_connected_account_id: "acct_new" };

    const response = await POST(
      new Request("http://localhost/api/payments/course-subscription/cancel", {
        method: "POST",
        body: JSON.stringify({ courseId: "course_1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_1", undefined, {
      stripeAccount: "acct_old",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true },
      { stripeAccount: "acct_old" },
    );
  });
});

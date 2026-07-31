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

describe("course subscription cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
                maybeSingle: async () => ({
                  data: { stripe_connected_account_id: "acct_teacher" },
                }),
              }),
            }),
          };
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
});

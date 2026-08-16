import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  requireUserId: vi.fn(),
  getAdmin: vi.fn(),
  getStripe: vi.fn(),
  refundCreate: vi.fn(),
  certificateResult: vi.fn(),
  ordersSelect: vi.fn(),
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

// Partial mock: paymentErrorResponse does `instanceof StripeConfigError`, so
// the real class has to survive.
vi.mock("@/lib/payments/server/stripe", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/payments/server/stripe")
  >();
  return { ...actual, getStripeClient: mocks.getStripe };
});

import { POST } from "@/app/api/payments/refunds/request/route";

function post() {
  return POST(
    new Request("http://localhost/api/payments/refunds/request", {
      method: "POST",
      body: JSON.stringify({ enrollmentId: "enr_1" }),
    }),
  );
}

describe("self-serve refund request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("user_1");
    mocks.getStripe.mockReturnValue({ refunds: { create: mocks.refundCreate } });
    // No certificate on file is the default: the guard should let the request
    // through and reach the orders lookup.
    mocks.certificateResult.mockResolvedValue({ data: null, error: null });
    mocks.ordersSelect.mockImplementation(() => {
      throw new Error("reached the orders lookup");
    });

    mocks.getAdmin.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "enrollments") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    user_id: "user_1",
                    course_id: "course_1",
                    source: "payment",
                    status: "active",
                    progress_percent: 0,
                  },
                }),
              }),
            }),
          };
        }
        if (table === "certificates") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: mocks.certificateResult }),
            }),
          };
        }
        return { select: mocks.ordersSelect };
      }),
    });
  });

  it("refuses the refund when the certificate lookup fails", async () => {
    // A read failure is indistinguishable from "no certificate". Swallowing it
    // let an already-certified enrollment be refunded — money out on a path
    // the policy blocks.
    mocks.certificateResult.mockResolvedValue({
      data: null,
      error: { message: "connection terminated" },
    });

    const response = await post();

    expect(response.status).toBe(500);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    // The guard must stop the request before anything downstream runs.
    expect(mocks.ordersSelect).not.toHaveBeenCalled();
  });

  it("blocks a refund once a certificate has been issued", async () => {
    mocks.certificateResult.mockResolvedValue({
      data: { status: "issued" },
      error: null,
    });

    const response = await post();

    expect(response.status).toBe(400);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("gets past the certificate guard when none exists", async () => {
    // Without this the fail-closed test above would still pass if the guard
    // rejected every request.
    await post();

    expect(mocks.ordersSelect).toHaveBeenCalled();
  });
});

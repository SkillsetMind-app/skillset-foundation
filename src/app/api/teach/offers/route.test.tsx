import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  requireUserId: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  requireUserId: mocks.requireUserId,
}));

import { POST } from "@/app/api/teach/offers/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/teach/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function courseQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: { id: "course", owner_id: "teacher" },
      error: null,
    })),
  };
  return query;
}

describe("atomic product offer creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("teacher");
  });

  it("creates offer, price and default state in one database transaction", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const admin = {
      from: vi.fn((table: string) => {
        if (table !== "courses") throw new Error(`Non-atomic write to ${table}`);
        return courseQuery();
      }),
      rpc,
    };
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({
      courseId: "course",
      name: "Annual access",
      amountMinor: 90_000,
      currency: "usd",
      paymentType: "subscription_yearly",
      isDefault: true,
      publicCode: "annual-2026",
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_product_offer_atomic",
      expect.objectContaining({
        p_course_id: "course",
        p_owner_id: "teacher",
        p_offer_id: expect.any(String),
        p_price_id: expect.any(String),
        p_name: "Annual access",
        p_amount_minor: 90_000,
        p_currency: "USD",
        p_payment_type: "subscription_yearly",
        p_is_default: true,
        p_public_code: "ANNUAL-2026",
      }),
    );
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        offerId: expect.any(String),
        priceId: expect.any(String),
        isDefault: true,
      }),
    );
  });

  it("surfaces the atomic RPC failure without falling back to partial writes", async () => {
    const admin = {
      from: vi.fn(() => courseQuery()),
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "atomic offer failed" },
      })),
    };
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({
      courseId: "course",
      name: "Monthly access",
      amountMinor: 10_000,
      currency: "USD",
      paymentType: "subscription_monthly",
      isDefault: false,
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
});

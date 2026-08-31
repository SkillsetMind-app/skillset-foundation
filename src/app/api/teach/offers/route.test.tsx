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

/**
 * The route makes two RPC calls: the rate-limit check and the atomic offer
 * write. Counting `rpc` globally would make "is the write atomic?" fail the
 * moment any unrelated RPC is added, so the assertions below count calls by
 * function name instead.
 */
function offerCalls(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter((call) => call[0] === "create_product_offer_atomic");
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
    expect(offerCalls(rpc)).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "enforce_rate_limit",
      expect.objectContaining({ p_key: "offer_write_teacher" }),
    );
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
    const rpc = vi.fn(async (fn: string) => ({
      data: null,
      error: fn === "create_product_offer_atomic"
        ? { message: "atomic offer failed" }
        : null,
    }));
    const admin = { from: vi.fn(() => courseQuery()), rpc };
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
    expect(offerCalls(rpc)).toHaveLength(1);
  });

  // A minor unit is the smallest amount a currency has, so 12.5 is not a price.
  // The old finite-only check accepted it and let a fraction of a cent into the
  // price row, where every conversion downstream had to round it back.
  it("refuses a fractional amountMinor before touching the database", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const admin = { from: vi.fn(() => courseQuery()), rpc };
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({
      courseId: "course",
      name: "Half a cent",
      amountMinor: 12.5,
      currency: "USD",
      paymentType: "one_time",
      isDefault: false,
    }));

    expect(response.status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
    expect(offerCalls(rpc)).toHaveLength(0);
  });

  // A moeda passava direto: String(body.currency ?? "USD").toUpperCase(), sem
  // nenhuma lista. Qualquer sigla de tres letras virava o codigo enviado ao
  // Stripe, e a correcao (isSupportedStripeCurrency) so tinha um teste que
  // procurava a chamada no texto do arquivo — grep passa verde com a validacao
  // presente e inerte. Este exercita a rota. (Auditoria de 2026-08-30, A-17.)
  it("refuses a currency Stripe does not support before touching the database", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const admin = { from: vi.fn(() => courseQuery()), rpc };
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({
      courseId: "course",
      name: "Moeda inventada",
      amountMinor: 10_000,
      currency: "XYZ",
      paymentType: "one_time",
      isDefault: false,
    }));

    expect(response.status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
    expect(offerCalls(rpc)).toHaveLength(0);
  });

  // Creating an offer is billable work on our Stripe account, so the throttle
  // fails CLOSED: over the limit, nothing reaches the course lookup or the write.
  it("refuses the write when the caller is over the offer rate limit", async () => {
    const rpc = vi.fn(async (fn: string) => ({
      data: null,
      error: fn === "enforce_rate_limit" ? { message: "RATE_LIMIT exceeded" } : null,
    }));
    const admin = { from: vi.fn(() => courseQuery()), rpc };
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({
      courseId: "course",
      name: "Monthly access",
      amountMinor: 10_000,
      currency: "USD",
      paymentType: "subscription_monthly",
      isDefault: false,
    }));

    expect(response.status).toBe(429);
    expect(admin.from).not.toHaveBeenCalled();
    expect(offerCalls(rpc)).toHaveLength(0);
  });
});

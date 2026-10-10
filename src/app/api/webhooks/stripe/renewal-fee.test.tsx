import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fixed per-sale fee on student-subscription renewals: Stripe takes only a
// percent on a subscription, so invoice.created writes the exact fee (plan
// percent + the fixed ~US$0.30) on each renewal while it is still a draft.

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  retrieve: vi.fn(),
  updateInvoice: vi.fn(),
  retrieveInvoice: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: vi.fn() }));
vi.mock("@/lib/payments/server/stripe", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    subscriptions: { retrieve: mocks.retrieve },
    invoices: { update: mocks.updateInvoice, retrieve: mocks.retrieveInvoice },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

function createDb(planId: string) {
  const query = (data: unknown) => {
    const q = {
      select: () => q,
      eq: () => q,
      upsert: () => q,
      update: () => q,
      maybeSingle: async () => ({ data, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ stripe_event_id: "evt" }], error: null }).then(ok),
    };
    return q;
  };
  return { from: (table: string) => query(table === "users" ? { current_plan_id: planId } : null) };
}

let counter = 0;
function deliver(invoice: Record<string, unknown>, account: string | null = "acct_teacher") {
  counter += 1;
  return POST(new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({
      id: `evt_invoice_created_${counter}`,
      type: "invoice.created",
      livemode: true,
      ...(account ? { account } : {}),
      data: { object: invoice },
    }),
  }));
}

function renewal(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_renewal_1",
    status: "draft",
    billing_reason: "subscription_cycle",
    amount_due: 2_000,
    currency: "usd",
    parent: { subscription_details: { subscription: "sub_student_1" } },
    ...overrides,
  };
}

describe("invoice.created on a student-subscription renewal", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_fixture");
    mocks.retrieve.mockReset().mockResolvedValue({
      id: "sub_student_1",
      metadata: { purpose: "course_subscription", teacherId: "teacher_1" },
    });
    mocks.updateInvoice.mockReset().mockResolvedValue({});
    mocks.retrieveInvoice.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["starter", Math.floor((2_000 * 490) / 10_000) + 30],
    ["pro", Math.floor((2_000 * 290) / 10_000) + 30],
    ["basic", Math.floor((2_000 * 1_000) / 10_000) + 30],
  ])("charges the %s percent plus the fixed fee, on the teacher's plan today", async (planId, fee) => {
    mocks.getAdmin.mockReturnValue(createDb(planId));

    expect((await deliver(renewal())).status).toBe(200);

    expect(mocks.updateInvoice).toHaveBeenCalledWith(
      "in_renewal_1",
      { application_fee_amount: fee },
      { stripeAccount: "acct_teacher" },
    );
  });

  it.each([
    ["the first invoice, paid at checkout", { billing_reason: "subscription_create" }],
    ["an invoice already finalized", { status: "open" }],
    ["a $0 invoice", { amount_due: 0 }],
  ])("leaves %s alone", async (_label, overrides) => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    expect((await deliver(renewal(overrides))).status).toBe(200);
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
  });

  // A redelivery after Stripe finalized the invoice: the snapshot still says
  // draft, the update is refused. Retrying cannot help, so it must not 500.
  it.each([
    ["Stripe says the invoice is not editable", { code: "invoice_not_editable" }, "draft"],
    ["the invoice is no longer a draft", { code: "invalid_request_error" }, "open"],
  ])("answers 200 when %s", async (_label, error, currentStatus) => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    mocks.updateInvoice.mockRejectedValue(Object.assign(new Error("not editable"), error));
    mocks.retrieveInvoice.mockResolvedValue({ id: "in_renewal_1", status: currentStatus });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await deliver(renewal())).status).toBe(200);
  });

  it("still fails, so Stripe retries, when the invoice is a draft and the update failed", async () => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    mocks.updateInvoice.mockRejectedValue(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
    mocks.retrieveInvoice.mockResolvedValue({ id: "in_renewal_1", status: "draft" });

    expect((await deliver(renewal())).status).toBe(500);
  });

  it("leaves the platform's own plan invoices alone", async () => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    expect((await deliver(renewal(), null)).status).toBe(200);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
  });

  it("leaves a connected account's own subscriptions alone", async () => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    mocks.retrieve.mockResolvedValue({ id: "sub_teacher_own", metadata: {} });
    expect((await deliver(renewal())).status).toBe(200);
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
  });
});

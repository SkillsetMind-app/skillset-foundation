import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fixed per-sale fee on student-subscription renewals: Stripe takes only a
// percent on a subscription, so invoice.created writes the exact fee (plan
// percent + the fixed ~US$0.30) on each renewal while it is still a draft.

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  retrieve: vi.fn(),
  updateSubscription: vi.fn(),
  notifyOps: vi.fn(),
  updateInvoice: vi.fn(),
  retrieveInvoice: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));
vi.mock("@/lib/payments/server/stripe", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    subscriptions: { retrieve: mocks.retrieve, update: mocks.updateSubscription },
    invoices: { update: mocks.updateInvoice, retrieve: mocks.retrieveInvoice },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

// course_1 belongs to teacher_1 (on the test plan) on the acct_teacher account;
// course_pro belongs to teacher_pro, a Pro teacher on another account.
function createDb(planId: string, savedSubscription = false) {
  const rows: Record<string, Record<string, Record<string, unknown>>> = {
    // The row that invoice.paid saves for a subscription of ours.
    course_subscriptions: savedSubscription
      ? { sub_student_1: { course_id: "course_1", user_id: "user_1", teacher_id: "teacher_1" } }
      : {},
    users: {
      teacher_1: { current_plan_id: planId, stripe_connected_account_id: "acct_teacher" },
      teacher_pro: { current_plan_id: "pro", stripe_connected_account_id: "acct_pro" },
    },
    courses: {
      course_1: { owner_id: "teacher_1", stripe_connected_account_id: "acct_teacher" },
      course_pro: { owner_id: "teacher_pro", stripe_connected_account_id: "acct_pro" },
    },
  };
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return q;
      },
      upsert: () => q,
      update: () => q,
      // users by uid, courses by id: the wrong column does not find the row.
      maybeSingle: async () => ({
        data: rows[table]?.[String(table === "users" ? filters.uid : filters.id)] ?? null,
        error: null,
      }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ stripe_event_id: "evt" }], error: null }).then(ok),
    };
    return q;
  };
  return { from: (table: string) => query(table) };
}

const ownCourse = { purpose: "course_subscription", courseId: "course_1", teacherId: "teacher_1" };

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
      metadata: ownCourse,
    });
    mocks.updateInvoice.mockReset().mockResolvedValue({});
    mocks.updateSubscription.mockReset().mockResolvedValue({});
    mocks.notifyOps.mockReset();
    mocks.retrieveInvoice.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["starter", Math.floor((2_000 * 490) / 10_000) + 30],
    ["basic", Math.floor((2_000 * 1_000) / 10_000) + 30],
  ])("charges the %s percent plus the fixed fee, on the teacher's plan today", async (planId, fee) => {
    mocks.getAdmin.mockReturnValue(createDb(planId));

    expect((await deliver(renewal())).status).toBe(200);

    expect(mocks.updateInvoice).toHaveBeenCalledWith(
      "in_renewal_1",
      { application_fee_amount: fee },
      { stripeAccount: "acct_teacher" },
    );
    // A paid-commission plan keeps the subscription's percent.
    expect(mocks.updateSubscription).not.toHaveBeenCalled();
  });

  // Pro is 0% since 2026-11-13: no percent and no fixed part.
  it("adds no fee on a Pro teacher's renewal", async () => {
    mocks.getAdmin.mockReturnValue(createDb("pro"));
    expect((await deliver(renewal())).status).toBe(200);
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
  });

  // Sold on Starter, teacher now on Pro: the subscription still carries the
  // Starter percent, so the draft comes with a fee. The renewal follows the plan.
  it("zeroes the fee a renewal inherited from the teacher's old plan", async () => {
    mocks.getAdmin.mockReturnValue(createDb("pro"));
    mocks.retrieve.mockResolvedValue({
      id: "sub_student_1",
      application_fee_percent: 6.4,
      metadata: ownCourse,
    });
    expect((await deliver(renewal())).status).toBe(200);
    // The subscription stops carrying the old percent, so later renewals and
    // the ledger follow the plan; this draft is zeroed too.
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      "sub_student_1",
      { application_fee_percent: "" },
      { stripeAccount: "acct_teacher" },
    );
    expect(mocks.updateInvoice).toHaveBeenCalledWith(
      "in_renewal_1",
      { application_fee_amount: 0 },
      { stripeAccount: "acct_teacher" },
    );
  });

  it("never holds the renewal when Stripe refuses to zero the fee, and tells ops", async () => {
    mocks.getAdmin.mockReturnValue(createDb("pro"));
    mocks.updateInvoice.mockRejectedValue(Object.assign(new Error("invalid"), { code: "parameter_invalid_integer" }));
    mocks.retrieveInvoice.mockResolvedValue({ id: "in_renewal_1", status: "draft" });
    mocks.retrieve.mockResolvedValue({
      id: "sub_student_1",
      application_fee_percent: 6.4,
      metadata: ownCourse,
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await deliver(renewal())).status).toBe(200);
    expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({ event: "stripe.webhook.zero_plan_fee_not_cleared" }));
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

  // teacherId and courseId live in the metadata, which the teacher edits in their own dashboard.
  it.each([
    ["a Pro teacher's id on the account's own course", { courseId: "course_1", teacherId: "teacher_pro" }],
    ["a Pro teacher's id and course", { courseId: "course_pro", teacherId: "teacher_pro" }],
  ])("touches no fee when the metadata names %s, and tells ops", async (_label, forged) => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    mocks.retrieve.mockResolvedValue({
      id: "sub_student_1",
      application_fee_percent: 6.4,
      metadata: { ...ownCourse, ...forged },
    });

    expect((await deliver(renewal())).status).toBe(200);

    expect(mocks.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
    expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
      event: "stripe.course_subscription.foreign_account",
      severity: "critical",
    }));
  });

  // A course that does not exist here and the teacher's own subscription: log only, no alert.
  it.each([
    ["no course", ""],
    ["a course that does not exist here", "course_unknown"],
  ])("touches no fee and sends no alert for %s", async (_label, courseId) => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.retrieve.mockResolvedValue({
      id: "sub_student_1",
      application_fee_percent: 6.4,
      metadata: { ...ownCourse, courseId, teacherId: "teacher_pro" },
    });

    expect((await deliver(renewal())).status).toBe(200);

    expect(mocks.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("charges our subscription from its saved course when the courseId metadata was edited", async () => {
    mocks.getAdmin.mockReturnValue(createDb("starter", true));
    mocks.retrieve.mockResolvedValue({
      id: "sub_student_1",
      metadata: { ...ownCourse, courseId: "course_unknown" },
    });

    expect((await deliver(renewal())).status).toBe(200);

    expect(mocks.updateInvoice).toHaveBeenCalledWith(
      "in_renewal_1",
      { application_fee_amount: Math.floor((2_000 * 490) / 10_000) + 30 },
      { stripeAccount: "acct_teacher" },
    );
    expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
      event: "stripe.course_subscription.metadata_mismatch",
    }));
  });

  // Sold on Pro (no percentage), downgraded teacher deletes metadata keys:
  // the saved row keeps the sale and the fee comes from the course owner's plan.
  it.each(["teacherId", "purpose", "courseId"])(
    "still charges the owner's plan fee when metadata %s was deleted", async (key) => {
      mocks.getAdmin.mockReturnValue(createDb("starter", true));
      const metadata: Record<string, string> = { ...ownCourse };
      delete metadata[key];
      mocks.retrieve.mockResolvedValue({ id: "sub_student_1", metadata });

      expect((await deliver(renewal())).status).toBe(200);

      expect(mocks.updateInvoice).toHaveBeenCalledWith(
        "in_renewal_1",
        { application_fee_amount: Math.floor((2_000 * 490) / 10_000) + 30 },
        { stripeAccount: "acct_teacher" },
      );
      expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
        event: "stripe.course_subscription.metadata_mismatch",
      }));
    },
  );

  // With STRIPE_CONNECT_APPLICATION_ID, a subscription without a saved row only
  // counts if our application created it; the one we already saved stays valid.
  it.each([
    ["created by the teacher's own keys, no saved row", null, false, false],
    ["created by our application, no saved row", "ca_ours", false, true],
    ["already saved, whatever created it", null, true, true],
  ])("with the application id set, handles a subscription %s", async (_label, application, saved, charged) => {
    vi.stubEnv("STRIPE_CONNECT_APPLICATION_ID", "ca_ours");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.getAdmin.mockReturnValue(createDb("starter", saved));
    mocks.retrieve.mockResolvedValue({ id: "sub_student_1", application, metadata: { ...ownCourse, userId: "user_1" } });

    expect((await deliver(renewal())).status).toBe(200);

    if (charged) {
      expect(mocks.updateInvoice).toHaveBeenCalledWith(
        "in_renewal_1",
        { application_fee_amount: Math.floor((2_000 * 490) / 10_000) + 30 },
        { stripeAccount: "acct_teacher" },
      );
    } else {
      expect(mocks.updateInvoice).not.toHaveBeenCalled();
      expect(mocks.updateSubscription).not.toHaveBeenCalled();
    }
  });

  it("leaves a connected account's own subscriptions alone", async () => {
    mocks.getAdmin.mockReturnValue(createDb("starter"));
    mocks.retrieve.mockResolvedValue({ id: "sub_teacher_own", metadata: {} });
    expect((await deliver(renewal())).status).toBe(200);
    expect(mocks.updateInvoice).not.toHaveBeenCalled();
  });
});

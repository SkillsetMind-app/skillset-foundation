import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The plan free trial, end to end through the webhook: a trialing subscription
// grants the plan, the account's one trial is recorded once, and the
// trial_will_end reminder goes out once per subscription.

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  retrieve: vi.fn(),
  preview: vi.fn(),
  fetch: vi.fn(),
  notifyOps: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));
vi.mock("@/lib/payments/server/stripe", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    subscriptions: { retrieve: mocks.retrieve },
    invoices: { createPreview: mocks.preview },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { ENTERPRISE_GRANT_METADATA, PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE, planById } from "@/data/plans";

type Row = Record<string, unknown>;

/** Just the tables the plan path touches, with PostgREST's semantics. */
function createDb() {
  const failures = { reminderWrites: 0 };
  const tables: Record<string, Row[]> = {
    subscriptions: [],
    users: [{ uid: "creator_1", current_plan_id: "free" }],
    creator_plan_trials: [],
    processed_stripe_events: [],
  };

  class Query {
    private op: "select" | "upsert" | "update" = "select";
    private values: Row = {};
    private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    private filters: Array<[string, (value: unknown) => boolean]> = [];
    constructor(private readonly table: string) {}
    select() { return this; }
    limit() { return this; }
    upsert(values: Row, options: Query["options"] = {}) { this.op = "upsert"; this.values = values; this.options = options; return this; }
    update(values: Row) { this.op = "update"; this.values = values; return this; }
    eq(column: string, value: unknown) { this.filters.push([column, (v) => v === value]); return this; }
    is(column: string, value: unknown) { this.filters.push([column, (v) => (v ?? null) === value]); return this; }
    in(column: string, values: unknown[]) { this.filters.push([column, (v) => values.includes(v)]); return this; }
    maybeSingle() { return Promise.resolve(this.run(true)); }
    then<T1 = unknown, T2 = never>(ok?: ((v: unknown) => T1 | PromiseLike<T1>) | null, ko?: ((r: unknown) => T2 | PromiseLike<T2>) | null) {
      return Promise.resolve(this.run(false)).then(ok, ko);
    }
    private matches(row: Row) { return this.filters.every(([column, test]) => test(row[column])); }
    private run(single: boolean) {
      if (this.table === "creator_plan_trials" && this.op === "update" && failures.reminderWrites > 0) {
        failures.reminderWrites -= 1;
        return { data: null, error: { message: "Delivery marker unavailable" } };
      }
      const rows = tables[this.table] ?? [];
      let touched: Row[] = [];
      if (this.op === "upsert") {
        const key = this.options.onConflict ?? "id";
        const existing = rows.find((row) => row[key] === this.values[key]);
        if (existing && !this.options.ignoreDuplicates) Object.assign(existing, this.values);
        if (!existing) rows.push({ ...this.values });
        touched = existing && this.options.ignoreDuplicates ? [] : [this.values];
      } else if (this.op === "update") {
        touched = rows.filter((row) => this.matches(row));
        for (const row of touched) Object.assign(row, this.values);
      } else {
        touched = rows.filter((row) => this.matches(row));
      }
      return { data: single ? touched[0] ?? null : touched, error: null };
    }
  }

  return {
    failures,
    tables,
    from: (table: string) => new Query(table),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "creator@example.test" } }, error: null }) } },
  };
}

const proMonthly = planById("pro").stripePriceIds!.monthlyId;
const starterMonthly = planById("starter").stripePriceIds!.monthlyId;
const basicMonthly = planById("basic").stripePriceIds!.monthlyId;
const enterpriseYearly = planById("plus").stripePriceIds!.yearlyId;
const TRIAL_END = Date.UTC(2026, 9, 20, 12) / 1000;

function planSubscription(overrides: Row = {}) {
  return {
    id: "sub_plan_1",
    customer: "cus_creator_1",
    status: "trialing",
    trial_start: Date.UTC(2026, 9, 6, 12) / 1000,
    trial_end: TRIAL_END,
    cancel_at_period_end: false,
    metadata: { uid: "creator_1", planId: "pro", cycle: "monthly", locale: "en" },
    items: { data: [{ price: { id: proMonthly, unit_amount: 8900, currency: "usd" }, current_period_end: TRIAL_END }] },
    ...overrides,
  };
}

let eventCounter = 0;
async function deliver(type: string, subscription: Row, extra: Row = {}) {
  mocks.retrieve.mockResolvedValueOnce(subscription);
  eventCounter += 1;
  return POST(new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: JSON.stringify({ id: `evt_${eventCounter}`, type, livemode: true, data: { object: { id: subscription.id } }, ...extra }),
  }));
}

describe("plan free trial through the Stripe webhook", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture");
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    vi.stubEnv("SKILLSET_APP_URL", "https://app.skillset.test");
    db = createDb();
    mocks.getAdmin.mockReturnValue(db);
    mocks.retrieve.mockReset();
    mocks.preview.mockReset().mockResolvedValue({ amount_due: 8900, currency: "usd" });
    mocks.notifyOps.mockReset();
    mocks.fetch.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts a trialing subscription as active: the plan, its commission and limits apply at once", async () => {
    expect((await deliver("customer.subscription.created", planSubscription())).status).toBe(200);

    expect(db.tables.users[0].current_plan_id).toBe("pro");
    expect(db.tables.subscriptions[0]).toMatchObject({
      status: "trialing",
      plan_id: "pro",
      trial_end: "2026-10-20T12:00:00.000Z",
    });
    expect(db.tables.creator_plan_trials).toEqual([
      expect.objectContaining({ user_id: "creator_1", stripe_subscription_id: "sub_plan_1" }),
    ]);
  });

  it("keeps the first trial record through a plan change during the trial", async () => {
    await deliver("customer.subscription.created", planSubscription());
    const changed = planSubscription({
      trial_end: TRIAL_END + 86_400,
      items: { data: [{ price: { id: starterMonthly, unit_amount: 1900, currency: "usd" } }] },
    });
    expect((await deliver("customer.subscription.updated", changed)).status).toBe(200);

    expect(db.tables.users[0].current_plan_id).toBe("starter");
    expect(db.tables.creator_plan_trials).toHaveLength(1);
    expect(db.tables.creator_plan_trials[0].trial_end).toBe("2026-10-20T12:00:00.000Z");
  });

  // A Basic payer is a paying customer: own-logo certificates, the public
  // storefront and no daily caps all key off current_plan_id <> 'free'.
  it.each(["trialing", "active"])("stores a %s Basic subscriber as basic, not free", async (status) => {
    await deliver("customer.subscription.created", planSubscription({
      status,
      metadata: { uid: "creator_1", planId: "basic", cycle: "monthly", locale: "en" },
      items: { data: [{ price: { id: basicMonthly, unit_amount: 500, currency: "usd" } }] },
    }));
    expect(db.tables.subscriptions[0]).toMatchObject({ plan_id: "basic", status });
    expect(db.tables.users[0].current_plan_id).toBe("basic");
  });

  it("keeps the highest tier when a creator holds two live subscriptions", async () => {
    db.tables.subscriptions.push({ id: "sub_old_pro", user_id: "creator_1", plan_id: "pro", status: "active" });
    await deliver("customer.subscription.created", planSubscription({
      status: "active",
      items: { data: [{ price: { id: basicMonthly, unit_amount: 500, currency: "usd" } }] },
    }));
    expect(db.tables.users[0].current_plan_id).toBe("pro");
  });

  it("resolves an Enterprise subscription that ops set up by hand", async () => {
    await deliver("customer.subscription.updated", planSubscription({
      status: "active",
      trial_start: null,
      trial_end: null,
      metadata: { uid: "creator_1", [ENTERPRISE_GRANT_METADATA.key]: ENTERPRISE_GRANT_METADATA.value },
      items: { data: [{ price: { id: enterpriseYearly, unit_amount: 199_000, currency: "usd" } }] },
    }));
    expect(db.tables.users[0].current_plan_id).toBe("plus");
    expect(db.tables.subscriptions[0]).toMatchObject({ plan_id: "plus", cycle: "yearly" });
    expect(db.tables.creator_plan_trials).toEqual([]);
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  // The Dashboard's default portal can still list Enterprise. A Basic trialist
  // who switches there must not get 1.9% and Enterprise limits for free.
  it("grants no plan for a self-serve switch to Enterprise and alerts ops", async () => {
    const basicMeta = { uid: "creator_1", planId: "basic", cycle: "monthly", locale: "en" };
    await deliver("customer.subscription.created", planSubscription({
      metadata: basicMeta,
      items: { data: [{ price: { id: basicMonthly, unit_amount: 500, currency: "usd" } }] },
    }));
    expect(db.tables.users[0].current_plan_id).toBe("basic");

    const switched = planSubscription({
      metadata: basicMeta,
      items: { data: [{ price: { id: enterpriseYearly, unit_amount: 199_000, currency: "usd" } }] },
    });
    expect((await deliver("customer.subscription.updated", switched)).status).toBe(200);

    expect(db.tables.subscriptions[0]).toMatchObject({ plan_id: null, status: "trialing" });
    expect(db.tables.users[0].current_plan_id).toBe("free");
    expect(mocks.notifyOps).toHaveBeenCalledWith(expect.objectContaining({
      event: "stripe.plan.enterprise_not_granted",
      severity: "critical",
    }));
  });

  it("sends the trial_will_end reminder once per subscription", async () => {
    await deliver("customer.subscription.created", planSubscription());
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(200);
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(200);

    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("trial_will_end:sub_plan_1");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["creator@example.test"]);
    expect(body.subject).toBe("Your free trial ends on October 20, 2026");
    expect(body.text).toContain("Your free trial ends on October 20, 2026. Your next payment is $89.00.");
    expect(body.text).toContain("Cancel here: https://app.skillset.test/account/billing?tab=subscriptions");
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toEqual(expect.any(String));
  });

  it("writes the reminder in the creator's language", async () => {
    const spanish = planSubscription({ metadata: { uid: "creator_1", planId: "pro", cycle: "monthly", locale: "es" } });
    await deliver("customer.subscription.trial_will_end", spanish);

    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1].body));
    expect(body.subject).toBe("Tu prueba gratis termina el 20 de octubre de 2026");
    expect(body.text).toContain("Tu próximo pago es de");
    expect(body.text).toContain("Cancela aquí: https://app.skillset.test/account/billing?tab=subscriptions");
  });

  it("does not remind a creator who already cancelled during the trial", async () => {
    await deliver("customer.subscription.trial_will_end", planSubscription({ cancel_at_period_end: true }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not mark a failed send as delivered, so Stripe's retry delivers it", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(500);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toBeUndefined();

    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toEqual(expect.any(String));
  });

  // California's auto-renewal law wants an acknowledgement after checkout, and
  // Stripe sends no receipt for a $0 trial invoice.
  function checkoutCompleted(eventId: string, subscription: Row) {
    mocks.retrieve.mockResolvedValueOnce(subscription);
    return POST(new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({
        id: eventId,
        type: "checkout.session.completed",
        livemode: true,
        data: { object: {
          id: `cs_${eventId}`,
          mode: "subscription",
          subscription: subscription.id,
          metadata: { uid: "creator_1", planId: "pro", cycle: "monthly", trialDays: "14", purpose: PLAN_SUBSCRIPTION_CHECKOUT_PURPOSE },
        } },
      }),
    }));
  }

  it("acknowledges a trial checkout once, with the end date, the price and how to cancel", async () => {
    expect((await checkoutCompleted("evt_cs_1", planSubscription())).status).toBe(200);
    expect((await checkoutCompleted("evt_cs_1", planSubscription())).status).toBe(200);

    expect(mocks.retrieve).toHaveBeenCalledWith("sub_plan_1");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("trial_started:sub_plan_1");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["creator@example.test"]);
    expect(body.subject).toBe("Your 14-day free trial started");
    expect(body.text).toContain(
      "Your 14-day free trial started. It ends on October 20, 2026. Your next payment is $89.00. Your subscription renews until you cancel.",
    );
    expect(body.text).toContain("Cancel anytime: https://app.skillset.test/account/billing?tab=subscriptions");
  });

  it("writes the trial acknowledgement in Spanish", async () => {
    await checkoutCompleted("evt_cs_es", planSubscription({
      metadata: { uid: "creator_1", planId: "pro", cycle: "monthly", locale: "es" },
    }));
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1].body));
    expect(body.subject).toBe("Tu prueba gratis de 14 días empezó");
    expect(body.text).toContain("Tu prueba gratis de 14 días empezó. Termina el 20 de octubre de 2026.");
    expect(body.text).toMatch(/Tu próximo pago es de .*89,00/);
    expect(body.text).toContain("Cancela cuando quieras: https://app.skillset.test/account/billing?tab=subscriptions");
  });

  it.each([
    ["a paid start, with no trial", { status: "active", trial_start: null, trial_end: null }],
    ["a trial already cancelled", { cancel_at_period_end: true }],
  ])("sends no trial acknowledgement for %s", async (_label, overrides) => {
    expect((await checkoutCompleted("evt_cs_none", planSubscription(overrides))).status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("writes the delivery marker only after the provider accepts the reminder", async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      expect(db.tables.creator_plan_trials[0].reminder_sent_at).toBeUndefined();
      return new Response("{}", { status: 200 });
    });
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(200);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toEqual(expect.any(String));
  });

  it("retries a failed delivery-marker write with the same provider idempotency key", async () => {
    db.failures.reminderWrites = 1;
    const event = { id: "evt_marker_retry" };
    expect((await deliver("customer.subscription.trial_will_end", planSubscription(), event)).status).toBe(500);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toBeUndefined();
    expect((await deliver("customer.subscription.trial_will_end", planSubscription(), event)).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mocks.fetch.mock.calls) {
      expect(init.headers["Idempotency-Key"]).toBe("trial_will_end:sub_plan_1");
    }
    expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[1][1].body);
  });

  it.each(["reminder", "acknowledgement"])("uses the discounted preview in the %s", async (kind) => {
    mocks.preview.mockResolvedValue({ amount_due: 4450, currency: "usd" });
    const response = kind === "reminder"
      ? await deliver("customer.subscription.trial_will_end", planSubscription())
      : await checkoutCompleted("evt_discount", planSubscription());
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({ subscription: "sub_plan_1" });
    const text = JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).text;
    expect(text).toContain("Your next payment is $44.50.");
    expect(text).not.toContain("$89.00");
    expect(text).not.toMatch(/\$44\.50(?:\/month| per month)/);
  });

  it.each(["reminder", "acknowledgement"])("retries a failed preview for the %s without sending or dumping the provider error", async (kind) => {
    mocks.preview.mockRejectedValueOnce(new Error("private provider diagnostic"));
    const send = () => kind === "reminder"
      ? deliver("customer.subscription.trial_will_end", planSubscription(), { id: "evt_preview_retry" })
      : checkoutCompleted("evt_preview_retry", planSubscription());
    expect((await send()).status).toBe(500);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(db.tables.creator_plan_trials[0]?.reminder_sent_at).toBeUndefined();
    expect(JSON.stringify(db.tables.processed_stripe_events)).not.toContain("private provider diagnostic");
    expect(vi.mocked(console.error).mock.calls.flat().map(String).join(" ")).not.toContain("private provider diagnostic");
    expect((await send()).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("preserves a zero-dollar preview instead of falling back to the list price", async () => {
    mocks.preview.mockResolvedValue({ amount_due: 0, currency: "usd" });
    expect((await checkoutCompleted("evt_free_renewal", planSubscription())).status).toBe(200);
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).text).toContain("Your next payment is $0.00.");
  });

  it.each([-1, NaN, 1.5, undefined])("fails closed on invalid preview amount %s", async (amount) => {
    mocks.preview.mockResolvedValue({ amount_due: amount, currency: "usd" });
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(500);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toBeUndefined();
  });

  it.each(["reminder", "acknowledgement"])("does not silently complete the %s without email configuration", async (kind) => {
    vi.stubEnv("RESEND_API_KEY", "");
    const response = kind === "reminder"
      ? await deliver("customer.subscription.trial_will_end", planSubscription())
      : await checkoutCompleted("evt_no_email_config", planSubscription());
    expect(response.status).toBe(500);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(db.tables.creator_plan_trials[0]?.reminder_sent_at).toBeUndefined();
  });

  it("ignores trial_will_end from a connected account (course subscriptions carry no trial)", async () => {
    mocks.retrieve.mockReset();
    const response = await POST(new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({
        id: "evt_connect_trial", type: "customer.subscription.trial_will_end", livemode: true,
        account: "acct_teacher", data: { object: { id: "sub_course_1" } },
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

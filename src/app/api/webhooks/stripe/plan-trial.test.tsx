import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The plan free trial, end to end through the webhook: a trialing subscription
// grants the plan, the account's one trial is recorded once, and the
// trial_will_end reminder goes out once per subscription.

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  retrieve: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: vi.fn() }));
vi.mock("@/lib/payments/server/stripe", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    subscriptions: { retrieve: mocks.retrieve },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { planById } from "@/data/plans";

type Row = Record<string, unknown>;

/** Just the tables the plan path touches, with PostgREST's semantics. */
function createDb() {
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
    tables,
    from: (table: string) => new Query(table),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "creator@example.test" } }, error: null }) } },
  };
}

const proMonthly = planById("pro").stripePriceIds!.monthlyId;
const starterMonthly = planById("starter").stripePriceIds!.monthlyId;
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
      items: { data: [{ price: { id: starterMonthly, unit_amount: 500, currency: "usd" } }] },
    });
    expect((await deliver("customer.subscription.updated", changed)).status).toBe(200);

    expect(db.tables.users[0].current_plan_id).toBe("starter");
    expect(db.tables.creator_plan_trials).toHaveLength(1);
    expect(db.tables.creator_plan_trials[0].trial_end).toBe("2026-10-20T12:00:00.000Z");
  });

  it("still resolves a subscription on the old $19 Starter price as Starter", async () => {
    const legacy = planById("starter").legacyStripePriceIds![0].monthlyId;
    await deliver("customer.subscription.updated", planSubscription({
      status: "active",
      trial_start: null,
      trial_end: null,
      items: { data: [{ price: { id: legacy, unit_amount: 1900, currency: "usd" } }] },
    }));
    expect(db.tables.users[0].current_plan_id).toBe("starter");
    expect(db.tables.subscriptions[0]).toMatchObject({ plan_id: "starter", cycle: "monthly" });
    expect(db.tables.creator_plan_trials).toEqual([]);
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
    expect(body.text).toContain("Your free trial ends on October 20, 2026. You'll be charged $89.00 per month.");
    expect(body.text).toContain("Cancel here: https://app.skillset.test/account/billing?tab=subscriptions");
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toEqual(expect.any(String));
  });

  it("writes the reminder in the creator's language", async () => {
    const spanish = planSubscription({ metadata: { uid: "creator_1", planId: "pro", cycle: "monthly", locale: "es" } });
    await deliver("customer.subscription.trial_will_end", spanish);

    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1].body));
    expect(body.subject).toBe("Tu prueba gratis termina el 20 de octubre de 2026");
    expect(body.text).toContain("Se te cobrará");
    expect(body.text).toContain("Cancela aquí: https://app.skillset.test/account/billing?tab=subscriptions");
  });

  it("does not remind a creator who already cancelled during the trial", async () => {
    await deliver("customer.subscription.trial_will_end", planSubscription({ cancel_at_period_end: true }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails, so Stripe's retry delivers it", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(500);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toBeNull();

    expect((await deliver("customer.subscription.trial_will_end", planSubscription())).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(db.tables.creator_plan_trials[0].reminder_sent_at).toEqual(expect.any(String));
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

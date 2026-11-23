import { afterEach, describe, expect, it, vi } from "vitest";

import { planById } from "@/data/plans";
import {
  checkWebhook,
  PLANS,
  upsertPrice,
  webhookUrlFrom,
} from "../../../scripts/setup-stripe-billing.mjs";

type FakePrice = { id: string; active: boolean; product: string; currency: string; unit_amount: number; recurring: { interval: string; interval_count: number } };

function fakeStripe({ byKey = [], onProduct = [], endpoints = [] }: {
  byKey?: FakePrice[];
  onProduct?: FakePrice[];
  endpoints?: Array<{ id: string; url: string; connect?: boolean; enabled_events: string[] }>;
} = {}) {
  return {
    prices: {
      list: vi.fn((params: { lookup_keys?: string[] }) => Object.assign(
        Promise.resolve({ data: params.lookup_keys ? byKey : onProduct }),
        { async *[Symbol.asyncIterator]() { yield* onProduct; } },
      )),
      create: vi.fn(async () => ({ id: "price_new" })),
    },
    webhookEndpoints: {
      list: vi.fn(async function* () { yield* endpoints; }),
      create: vi.fn(async () => ({ id: "we_new", secret: "whsec_must_not_leak" })),
    },
  };
}

const basic = PLANS[0];
const product = { id: "prod_basic" };

// The script used to fall back to a legacy Firebase URL, create an endpoint
// there and print its signing secret, and could mint twin $19/$89 Prices.
describe("scripts/setup-stripe-billing.mjs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("provisions only Basic, at the prices plans.ts sells", () => {
    expect(PLANS.map((plan) => plan.id)).toEqual(["basic"]);
    expect(basic.monthlyUsd).toBe(planById("basic").monthlyUsd);
    expect(basic.yearlyUsd).toBe(planById("basic").yearlyUsd);
  });

  it("has no default webhook URL", () => {
    expect(webhookUrlFrom({})).toBeNull();
    expect(webhookUrlFrom({ STRIPE_WEBHOOK_URL: "  " })).toBeNull();
    expect(webhookUrlFrom({ STRIPE_WEBHOOK_URL: "https://www.skillsetmind.com/api/webhooks/stripe" }))
      .toBe("https://www.skillsetmind.com/api/webhooks/stripe");
  });

  it.each([
    { unit_amount: 500 }, { currency: "eur" }, { product: "prod_other" },
    { recurring: { interval: "year", interval_count: 1 } },
    { recurring: { interval: "month", interval_count: 2 } },
  ])("stops on a mismatched lookup key without creating a twin: %j", async (mismatch) => {
    const stripe = fakeStripe({ byKey: [{ id: "price_wrong", active: true, product: product.id,
      currency: "usd", unit_amount: 900, recurring: { interval: "month", interval_count: 1 }, ...mismatch }] });
    await expect(upsertPrice(stripe, basic, product, "monthly")).rejects.toThrow(/does not match/);
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it.each(["monthly", "yearly"])("reuses the new %s lookup without touching legacy prices", async (cycle) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe({ byKey: [{ id: "price_current", active: true, product: product.id,
      currency: "usd", unit_amount: cycle === "monthly" ? 900 : 9000,
      recurring: { interval: cycle === "monthly" ? "month" : "year", interval_count: 1 } }] });
    await upsertPrice(stripe, basic, product, cycle);
    expect(stripe.prices.list).toHaveBeenCalledWith({ lookup_keys: [`skillset_basic_${cycle}_20261028`], limit: 1 });
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("reuses the Price under its lookup key and creates nothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe({ byKey: [{ id: "price_basic_m", active: true, product: "prod_basic", currency: "usd", unit_amount: 900, recurring: { interval: "month", interval_count: 1 } }] });
    expect((await upsertPrice(stripe, basic, product, "monthly")).id).toBe("price_basic_m");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("stops on an archived Price under the key instead of creating a twin", async () => {
    const stripe = fakeStripe({ byKey: [{ id: "price_old", active: false, product: "prod_basic", currency: "usd", unit_amount: 900, recurring: { interval: "month", interval_count: 1 } }] });
    await expect(upsertPrice(stripe, basic, product, "monthly")).rejects.toThrow(/archived/);
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("reuses a Dashboard-made Price with the same amount and interval", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe({ onProduct: [{ id: "price_dash_y", active: true, product: "prod_basic", currency: "usd", unit_amount: 9000, recurring: { interval: "year", interval_count: 1 } }] });
    expect((await upsertPrice(stripe, basic, product, "yearly")).id).toBe("price_dash_y");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("creates the Price with its lookup key only when none exists", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe();
    await upsertPrice(stripe, basic, product, "monthly");
    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      unit_amount: 900,
      recurring: { interval: "month" },
      lookup_key: "skillset_basic_monthly_20261028",
    }));
  });

  it.each([true, false])("scans past archived matches before deciding to reuse or reject (active %s)", async (hasActive) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const archived: FakePrice = { id: "price_archived", active: false, product: product.id, currency: "usd",
      unit_amount: 900, recurring: { interval: "month", interval_count: 1 } };
    const stripe = fakeStripe({ onProduct: [archived, ...(hasActive ? [{ ...archived, id: "price_active", active: true }] : [])] });
    if (hasActive) expect((await upsertPrice(stripe, basic, product, "monthly")).id).toBe("price_active");
    else await expect(upsertPrice(stripe, basic, product, "monthly")).rejects.toThrow(/archived/);
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("never hands back a new endpoint's signing secret", async () => {
    const stripe = fakeStripe();
    const result = await checkWebhook(stripe, "https://www.skillsetmind.com/api/webhooks/stripe");
    expect(result).toEqual({ id: "we_new", created: true, missing: [] });
    expect(JSON.stringify(result)).not.toContain("whsec_");
  });

  it("ignores a Connect endpoint on the same URL and creates the platform one", async () => {
    const url = "https://www.skillsetmind.com/api/webhooks/stripe";
    const stripe = fakeStripe({ endpoints: [{ id: "we_connect", url, connect: true, enabled_events: ["*"] }] });
    const result = await checkWebhook(stripe, url);
    expect(result).toEqual({ id: "we_new", created: true, missing: [] });
  });

  it("reports the events an existing endpoint lacks, without changing it", async () => {
    const url = "https://www.skillsetmind.com/api/webhooks/stripe";
    const stripe = fakeStripe({ endpoints: [{ id: "we_1", url, enabled_events: ["customer.subscription.created"] }] });
    const result = await checkWebhook(stripe, url);
    expect(result.created).toBe(false);
    expect(result.missing).toContain("customer.subscription.trial_will_end");
    expect(stripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });
});

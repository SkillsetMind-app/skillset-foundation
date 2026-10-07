import { afterEach, describe, expect, it, vi } from "vitest";

import { planById } from "@/data/plans";
import {
  checkWebhook,
  PLANS,
  upsertPrice,
  webhookUrlFrom,
} from "../../../scripts/setup-stripe-billing.mjs";

type FakePrice = { id: string; active: boolean; currency: string; unit_amount: number; recurring: { interval: string } };

function fakeStripe({ byKey = [], onProduct = [], endpoints = [] }: {
  byKey?: FakePrice[];
  onProduct?: FakePrice[];
  endpoints?: Array<{ id: string; url: string; enabled_events: string[] }>;
} = {}) {
  return {
    prices: {
      list: vi.fn(async (params: { lookup_keys?: string[] }) => ({ data: params.lookup_keys ? byKey : onProduct })),
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

  it("reuses the Price under its lookup key and creates nothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe({ byKey: [{ id: "price_basic_m", active: true, currency: "usd", unit_amount: 500, recurring: { interval: "month" } }] });
    expect((await upsertPrice(stripe, basic, product, "monthly")).id).toBe("price_basic_m");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("stops on an archived Price under the key instead of creating a twin", async () => {
    const stripe = fakeStripe({ byKey: [{ id: "price_old", active: false, currency: "usd", unit_amount: 500, recurring: { interval: "month" } }] });
    await expect(upsertPrice(stripe, basic, product, "monthly")).rejects.toThrow(/archived/);
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("reuses a Dashboard-made Price with the same amount and interval", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe({ onProduct: [{ id: "price_dash_y", active: true, currency: "usd", unit_amount: 5000, recurring: { interval: "year" } }] });
    expect((await upsertPrice(stripe, basic, product, "yearly")).id).toBe("price_dash_y");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("creates the Price with its lookup key only when none exists", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stripe = fakeStripe();
    await upsertPrice(stripe, basic, product, "monthly");
    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      unit_amount: 500,
      recurring: { interval: "month" },
      lookup_key: "skillset_basic_monthly",
    }));
  });

  it("never hands back a new endpoint's signing secret", async () => {
    const stripe = fakeStripe();
    const result = await checkWebhook(stripe, "https://www.skillsetmind.com/api/webhooks/stripe");
    expect(result).toEqual({ id: "we_new", created: true, missing: [] });
    expect(JSON.stringify(result)).not.toContain("whsec_");
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

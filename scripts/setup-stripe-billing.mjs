#!/usr/bin/env node
/**
 * Creates the Skillset Basic Product and its two Prices on Stripe, idempotently.
 *
 *   - Basic: $5/month (lookup key skillset_basic_monthly) and $50/year
 *     (skillset_basic_yearly), recurring USD.
 *   - Starter, Pro and Enterprise already exist and src/data/plans.ts carries
 *     their Price ids. This script never creates them, so it cannot mint a
 *     second $19 or $89 Price.
 *
 * Optional: set STRIPE_WEBHOOK_URL to the REAL platform endpoint
 * (https://<production host>/api/webhooks/stripe) to check that endpoint's
 * events, or create it if it does not exist. There is no default URL: without
 * it the webhook step is skipped. The signing secret is never printed; reveal
 * it in the Dashboard (Developers → Webhooks → the endpoint → Signing secret).
 *
 * Run through the vault, never with the key on the command line:
 *   py -3.13 C:\Users\nicae\.claude\seguranca\cofre.py roda STRIPE_SECRET_KEY -- node scripts/setup-stripe-billing.mjs
 *
 * Re-running is safe:
 *   - The Product is reused when one carries metadata.skillset_plan_id=basic or
 *     is named "Skillset Basic".
 *   - A Price is reused by lookup key. An archived Price under the key stops
 *     the run (reactivate it; never a twin). A Price on the Product with the
 *     same amount and interval but no lookup key is reused too.
 */

import { pathToFileURL } from "node:url";
import Stripe from "stripe";

// The platform endpoint's events for the plan flow. Read-only check against an
// existing endpoint; only used as-is when the endpoint has to be created.
export const WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // The 14-day plan trial: the reminder email before it converts.
  "customer.subscription.trial_will_end",
  "invoice.payment_failed",
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
];

// MUST match the basic entry in src/data/plans.ts.
export const PLANS = [
  {
    id: "basic",
    name: "Skillset Basic",
    description: "10% + $0.30 per sale.",
    monthlyUsd: 5,
    yearlyUsd: 50,
  },
];

/** The webhook URL to check, or null: there is no default endpoint. */
export function webhookUrlFrom(env) {
  const url = (env.STRIPE_WEBHOOK_URL ?? "").trim();
  return url || null;
}

export async function upsertProduct(stripe, plan) {
  const found = await stripe.products.search({
    query: `metadata['skillset_plan_id']:'${plan.id}' OR name:'${plan.name}'`,
  });
  if (found.data[0]) {
    console.log(`  ✓ Product '${plan.name}' already exists: ${found.data[0].id}`);
    return found.data[0];
  }
  const product = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { skillset_plan_id: plan.id },
  });
  console.log(`  + Product '${plan.name}' created: ${product.id}`);
  return product;
}

export async function upsertPrice(stripe, plan, product, cycle) {
  const lookupKey = `skillset_${plan.id}_${cycle}`;
  const amount = (cycle === "monthly" ? plan.monthlyUsd : plan.yearlyUsd) * 100;
  const interval = cycle === "monthly" ? "month" : "year";

  // Active or not: a lookup key names one Price.
  const byKey = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const existing = byKey.data[0];
  if (existing) {
    if (!existing.active) {
      throw new Error(
        `Price ${existing.id} (${lookupKey}) is archived. Reactivate it in the Dashboard; this script will not create a second one.`,
      );
    }
    console.log(`  ✓ Price '${lookupKey}' already exists: ${existing.id}`);
    return existing;
  }

  // Made in the Dashboard without the lookup key: same Product, amount and
  // interval is the same Price.
  const onProduct = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const twin = onProduct.data.find(
    (price) => price.currency === "usd"
      && price.unit_amount === amount
      && price.recurring?.interval === interval,
  );
  if (twin) {
    console.log(`  ✓ Price ${twin.id} already exists without a lookup key; set it to '${lookupKey}' in the Dashboard.`);
    return twin;
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { skillset_plan_id: plan.id, skillset_cycle: cycle },
  });
  console.log(`  + Price '${lookupKey}' created: ${price.id}`);
  return price;
}

/**
 * Finds the endpoint at `url` and reports the events it lacks, or creates it.
 * Never returns or prints the signing secret.
 */
export async function checkWebhook(stripe, url) {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url !== url || endpoint.connect === true) continue;
    const all = endpoint.enabled_events.includes("*");
    const missing = all ? [] : WEBHOOK_EVENTS.filter((event) => !endpoint.enabled_events.includes(event));
    return { id: endpoint.id, created: false, missing };
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "Skillset plan subscriptions (setup-stripe-billing)",
  });
  return { id: endpoint.id, created: true, missing: [] };
}

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!/^(sk|rk)_(test|live)_/.test(key)) {
    // No echo of the value: if it is not a Stripe key it may be any other
    // secret pasted in the wrong place.
    console.error("STRIPE_SECRET_KEY is missing or is not a Stripe secret key.");
    process.exit(1);
  }
  const live = /^(sk|rk)_live_/.test(key);
  const stripe = new Stripe(key);
  console.log(`Skillset Basic on Stripe (${live ? "LIVE" : "TEST"})`);

  const ids = {};
  for (const plan of PLANS) {
    const product = await upsertProduct(stripe, plan);
    ids[plan.id] = {
      monthly: (await upsertPrice(stripe, plan, product, "monthly")).id,
      yearly: (await upsertPrice(stripe, plan, product, "yearly")).id,
    };
  }

  const url = webhookUrlFrom(process.env);
  if (!url) {
    console.log("\nWebhook: skipped (STRIPE_WEBHOOK_URL not set; there is no default).");
  } else {
    const webhook = await checkWebhook(stripe, url);
    console.log(`\nWebhook ${webhook.id} ${webhook.created ? "created" : "found"} at ${url}.`);
    if (webhook.created) {
      console.log("  Reveal its signing secret in the Dashboard and store it in the vault; it is not printed here.");
    }
    if (webhook.missing.length > 0) {
      console.log(`  Missing events (add them in the Dashboard): ${webhook.missing.join(", ")}`);
    }
  }

  console.log("\nsrc/data/plans.ts, the basic entry:");
  for (const plan of PLANS) {
    console.log(`  monthlyId: "${ids[plan.id].monthly}",`);
    console.log(`  yearlyId: "${ids[plan.id].yearly}",`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Message only: a Stripe error object can carry request details.
    console.error(`Failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}

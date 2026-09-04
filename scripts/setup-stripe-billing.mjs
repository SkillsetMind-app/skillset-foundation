#!/usr/bin/env node
/**
 * One-shot setup for Skillset's subscription billing on Stripe.
 *
 * Creates (idempotently, by lookup_key + metadata):
 *   - 3 Products:  Skillset Starter / Pro / Plus
 *   - 6 Prices:    each Product × {monthly, yearly} in USD recurring
 *   - 1 Webhook Endpoint pointing at the deployed stripeWebhook function
 *     with the exact set of events the in-app subscription flow listens to.
 *
 * Prints the price IDs and the webhook signing secret in copy-paste form
 * for the in-repo replacement (src/data/plans.ts + functions/src/index.ts).
 *
 * Run:
 *   STRIPE_SECRET_KEY=sk_live_xxx \
 *   STRIPE_WEBHOOK_URL=https://us-central1-skillsetusaofficial.cloudfunctions.net/stripeWebhook \
 *     node scripts/setup-stripe-billing.mjs
 *
 * Defaults to the standard cloudfunctions.net URL when STRIPE_WEBHOOK_URL is
 * not set. If you've deployed functions as Gen2 with a *.run.app endpoint,
 * pass that URL explicitly so the webhook signature signs against it.
 *
 * Re-running is safe:
 *   - Existing Products are reused (matched by metadata.skillset_plan_id).
 *   - Existing Prices with the same lookup_key are reused as-is.
 *   - An existing Webhook Endpoint at the same URL is reused (BUT its
 *     signing secret is only returned at creation — Stripe doesn't allow
 *     reading it back. If it already exists, this script tells you to
 *     rotate it manually in the Dashboard if you lost the secret.)
 */

import Stripe from "stripe";

const SECRET = process.env.STRIPE_SECRET_KEY;
if (!SECRET) {
  console.error(
    "ERROR: STRIPE_SECRET_KEY is required.\n" +
      "Run with:  STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-stripe-billing.mjs",
  );
  process.exit(1);
}
if (!SECRET.startsWith("sk_")) {
  // Sem eco do valor, nem dos primeiros caracteres: a variavel esta errada
  // JUSTAMENTE porque nao e uma chave Stripe, entao o que estiver ali pode ser
  // qualquer outro segredo colado no lugar errado -- e um terminal, um log de
  // CI ou um screenshot de suporte carrega isso adiante.
  console.error(
    "ERROR: STRIPE_SECRET_KEY has an invalid format (expected a key starting with 'sk_').",
  );
  process.exit(1);
}

const isLive = SECRET.startsWith("sk_live_");
const MODE_LABEL = isLive ? "LIVE" : "TEST";

const WEBHOOK_URL =
  process.env.STRIPE_WEBHOOK_URL ||
  "https://us-central1-skillsetusaofficial.cloudfunctions.net/stripeWebhook";

const WEBHOOK_EVENTS = [
  // Subscriptions (new — Wave 5B)
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  // Course one-time checkout (existing — keep ringing through this webhook)
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
];

// Catalog — MUST match src/data/plans.ts. Keep in sync.
const PLANS = [
  {
    id: "starter",
    name: "Skillset Starter",
    description:
      "Lower commission as sales grow. 4% per sale. Every Skillset feature included.",
    monthlyUsd: 19,
    yearlyUsd: 190,
  },
  {
    id: "pro",
    name: "Skillset Pro",
    description:
      "Almost zero commission for established catalogs. 1% per sale. Priority support.",
    monthlyUsd: 89,
    yearlyUsd: 890,
  },
  {
    id: "plus",
    name: "Skillset Plus",
    description: "Zero commission for high-volume creators. Dedicated launch reviews.",
    monthlyUsd: 199,
    yearlyUsd: 1990,
  },
];

const stripe = new Stripe(SECRET, { apiVersion: "2025-06-30.basil" });

function header(text) {
  const line = "─".repeat(text.length + 4);
  console.log("\n" + line + "\n  " + text + "\n" + line);
}

async function findProductByPlanId(planId) {
  const found = await stripe.products.search({
    query: `metadata['skillset_plan_id']:'${planId}'`,
  });
  return found.data[0] ?? null;
}

async function findPriceByLookupKey(lookupKey) {
  const found = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  return found.data[0] ?? null;
}

async function upsertProduct(plan) {
  const existing = await findProductByPlanId(plan.id);
  if (existing) {
    console.log(`  ✓ Product '${plan.name}' already exists: ${existing.id}`);
    return existing;
  }
  const product = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { skillset_plan_id: plan.id },
  });
  console.log(`  + Product '${plan.name}' created: ${product.id}`);
  return product;
}

async function upsertPrice(plan, product, cycle) {
  const monthlyAmount = cycle === "monthly" ? plan.monthlyUsd : plan.yearlyUsd;
  const lookupKey = `skillset_${plan.id}_${cycle}`;

  const existing = await findPriceByLookupKey(lookupKey);
  if (existing) {
    console.log(
      `  ✓ Price '${lookupKey}' already exists: ${existing.id}` +
        ` (${(existing.unit_amount ?? 0) / 100} ${(existing.currency ?? "").toUpperCase()})`,
    );
    return existing;
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: monthlyAmount * 100,
    recurring: { interval: cycle === "monthly" ? "month" : "year" },
    lookup_key: lookupKey,
    metadata: {
      skillset_plan_id: plan.id,
      skillset_cycle: cycle,
    },
  });
  console.log(
    `  + Price '${lookupKey}' created: ${price.id} ` +
      `($${monthlyAmount}/${cycle === "monthly" ? "mo" : "yr"})`,
  );
  return price;
}

async function findWebhookByUrl(url) {
  // No filter by url in the list call — paginate and match.
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === url) return endpoint;
  }
  return null;
}

async function upsertWebhook() {
  const existing = await findWebhookByUrl(WEBHOOK_URL);
  if (existing) {
    console.log(`  ✓ Webhook for ${WEBHOOK_URL} already exists: ${existing.id}`);
    console.log(
      `    Configured events: ${existing.enabled_events.length} (will not modify)`,
    );
    return { endpoint: existing, secret: null };
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: WEBHOOK_EVENTS,
    description: "Skillset subscriptions + course checkout (auto-created)",
  });
  console.log(`  + Webhook created: ${endpoint.id}`);
  return { endpoint, secret: endpoint.secret };
}

async function main() {
  header(`Setting up Skillset billing on Stripe (${MODE_LABEL})`);

  if (!isLive) {
    console.log(
      "  ! Running in TEST mode. Re-run with sk_live_* to provision real billing.",
    );
  }

  // 1. Products
  header("1/3  Products");
  const products = {};
  for (const plan of PLANS) {
    products[plan.id] = await upsertProduct(plan);
  }

  // 2. Prices
  header("2/3  Prices");
  const priceIds = {};
  for (const plan of PLANS) {
    priceIds[plan.id] = {
      monthly: (await upsertPrice(plan, products[plan.id], "monthly")).id,
      yearly: (await upsertPrice(plan, products[plan.id], "yearly")).id,
    };
  }

  // 3. Webhook
  header("3/3  Webhook endpoint");
  const { secret: newWebhookSecret } = await upsertWebhook();

  // Copy-paste section
  header("Copy-paste BLOCKS for the repo");

  console.log(
    "\nReplace the placeholder Price IDs in BOTH places:\n" +
      "  src/data/plans.ts (stripePriceIds on starter/pro/plus)\n" +
      "  functions/src/index.ts (PLAN_PRICE_MAP)\n",
  );

  console.log("// src/data/plans.ts — patch:\n");
  for (const plan of PLANS) {
    console.log(`  ${plan.id}: {`);
    console.log(`    monthlyId: "${priceIds[plan.id].monthly}",`);
    console.log(`    yearlyId:  "${priceIds[plan.id].yearly}",`);
    console.log(`  },`);
  }

  console.log("\n\n// functions/src/index.ts — patch PLAN_PRICE_MAP:\n");
  console.log("const PLAN_PRICE_MAP = {");
  for (const plan of PLANS) {
    console.log(`  ${plan.id}: {`);
    console.log(`    monthly: "${priceIds[plan.id].monthly}",`);
    console.log(`    yearly:  "${priceIds[plan.id].yearly}",`);
    console.log(`  },`);
  }
  console.log("};");

  if (newWebhookSecret) {
    console.log("\n\n// Webhook signing secret (set as functions secret):\n");
    console.log(`  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`);
    console.log(`  # When prompted, paste:`);
    console.log(`  ${newWebhookSecret}`);
  } else {
    console.log(
      "\n\n! Webhook endpoint already existed at this URL. Stripe does not\n" +
        "  expose the signing secret after creation. If you don't already\n" +
        "  have STRIPE_WEBHOOK_SECRET set, rotate it in the Dashboard:\n" +
        `    https://dashboard.stripe.com/${isLive ? "" : "test/"}webhooks\n` +
        "  → click your endpoint → 'Roll secret' → copy → firebase functions:secrets:set.",
    );
  }

  console.log(
    "\n\nNext:\n" +
      "  1. Paste the two blocks above into the listed files.\n" +
      "  2. firebase functions:secrets:set STRIPE_SECRET_KEY  (sk_live_*)\n" +
      "  3. firebase functions:secrets:set STRIPE_WEBHOOK_SECRET (whsec_*)\n" +
      "  4. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_* in hosting env.\n" +
      "  5. firebase deploy --only functions\n" +
      "  6. firebase deploy --only hosting\n",
  );
}

main().catch((error) => {
  console.error("\nERROR:", error.message);
  if (error.raw) {
    console.error("Stripe error type:", error.raw.type);
  }
  process.exit(1);
});

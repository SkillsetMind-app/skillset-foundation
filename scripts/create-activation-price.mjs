/**
 * Creates the one-time Stripe Price for the storefront activation fee.
 *
 * Idempotent: the Price carries a lookup_key, so a second run retrieves the
 * existing one instead of creating a duplicate. A duplicated Price is not a
 * cosmetic problem here — plans.ts points at exactly one id, and the other would
 * sit in the account looking equally valid.
 *
 * Never prints the secret key. Prints ids and livemode only.
 *
 *   node scripts/create-activation-price.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";

const ROOT = process.cwd();
const LOOKUP_KEY = "skillset_storefront_activation_one_time";
const PRODUCT_NAME = "SkillsetMind Storefront Activation";
const UNIT_AMOUNT_MINOR = 2500; // $25.00 USD — mirrors activationFeeUsd in src/data/plans.ts
const CURRENCY = "usd";

// A known-good Price from src/data/plans.ts (Starter monthly). Retrieving it
// proves the key we loaded points at the SAME Stripe account and mode the app
// already uses — otherwise we would create the fee in a stranger account.
const CANARY_PRICE_ID = "price_1TZFTmPvg1vJW0IjLAYWqZok";

function loadSecretKey() {
  const envPath = path.join(ROOT, ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== "STRIPE_SECRET_KEY") continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  throw new Error("STRIPE_SECRET_KEY not found in .env.local");
}

const secretKey = loadSecretKey();
const stripe = new Stripe(secretKey);

const canary = await stripe.prices.retrieve(CANARY_PRICE_ID);
console.log(
  `canary ok: ${canary.id} livemode=${canary.livemode} product=${canary.product}`,
);
console.log(`MODE: ${canary.livemode ? "LIVE" : "TEST"}`);

const existing = await stripe.prices.list({
  lookup_keys: [LOOKUP_KEY],
  limit: 1,
});
if (existing.data.length > 0) {
  const price = existing.data[0];
  console.log(
    `ALREADY EXISTS: ${price.id} amount=${price.unit_amount} ${price.currency} type=${price.type}`,
  );
  console.log(`PRICE_ID=${price.id}`);
  process.exit(0);
}

const product = await stripe.products.create({
  name: PRODUCT_NAME,
  description:
    "One-time fee that activates a creator's storefront and unlocks publishing. Charged once per creator.",
  metadata: { purpose: "skillset_activation_fee" },
});
console.log(`created product: ${product.id}`);

const price = await stripe.prices.create({
  product: product.id,
  unit_amount: UNIT_AMOUNT_MINOR,
  currency: CURRENCY,
  lookup_key: LOOKUP_KEY,
  metadata: { purpose: "skillset_activation_fee" },
});
console.log(
  `created price: ${price.id} amount=${price.unit_amount} ${price.currency} type=${price.type} livemode=${price.livemode}`,
);
console.log(`PRICE_ID=${price.id}`);

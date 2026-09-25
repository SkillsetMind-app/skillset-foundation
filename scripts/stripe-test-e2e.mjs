#!/usr/bin/env node
/**
 * Stripe TEST end-to-end simulation for the Skillset marketplace.
 *
 * Two modes:
 *  - MATH mode (default, no creds): prints a money split for sample prices
 *    using a HISTORICAL copy of the Firebase-era formulas. They do NOT track
 *    the current code (see the note above the formulas below), so do not use
 *    this table to check real fees or ledger numbers.
 *  - LIVE-TEST mode (when STRIPE_SECRET_KEY=sk_test_... is set): also
 *    creates a real Stripe TEST Checkout Session to prove API wiring.
 *
 * Run:  node scripts/stripe-test-e2e.mjs
 *       STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-test-e2e.mjs
 *
 * Card for manual UI test: 4242 4242 4242 4242, any future date, any CVC.
 */

// ---- HISTORICAL copy of the Firebase-era formulas; does NOT track the code ----
// The current fee rules live in src/lib/payments/rules.ts
// (DEFAULT_PLATFORM_FEE_BPS, canonicalPlatformFeeBpsForPlan,
// stripeProcessingFeeMinor) and the split is computed in
// src/app/api/webhooks/stripe/route.ts. The constants below differ from them
// (platform fee bps and the non-USD processing percentage).
const DEFAULT_PLATFORM_FEE_BPS = 1500; // 15%

function stripeProcessingFeeMinor(grossMinor, currency) {
  const isUsd = (currency || "").toUpperCase() === "USD";
  const percentBps = isUsd ? 290 : 390; // 2.9% vs 3.9%
  const fixedMinor = 30; // $0.30 equivalent
  return Math.round((grossMinor * percentBps) / 10000) + fixedMinor;
}

function splitOrder(grossMinor, currency, platformFeeBps = DEFAULT_PLATFORM_FEE_BPS) {
  const skillsetFeeMinor = Math.floor((grossMinor * platformFeeBps) / 10000);
  const stripeFeeMinor = stripeProcessingFeeMinor(grossMinor, currency);
  const netAmountMinor = Math.max(0, grossMinor - skillsetFeeMinor - stripeFeeMinor);
  return { grossMinor, skillsetFeeMinor, stripeFeeMinor, netAmountMinor };
}

const usd = (minor) => `$${(minor / 100).toFixed(2)}`;

function row(label, gross, currency) {
  const s = splitOrder(gross, currency);
  const platformNet = s.skillsetFeeMinor; // we keep full commission; stripe fee passed to teacher
  return [
    label.padEnd(22),
    usd(s.grossMinor).padStart(9),
    usd(s.skillsetFeeMinor).padStart(11),
    usd(s.stripeFeeMinor).padStart(10),
    usd(s.netAmountMinor).padStart(12),
    usd(platformNet).padStart(12),
  ].join(" | ");
}

console.log("\n=== Skillset payment split — MATH mode (mirrors index.ts) ===\n");
console.log(
  ["scenario".padEnd(22), "gross".padStart(9), "platform15%".padStart(11),
   "stripeFee".padStart(10), "teacherNet".padStart(12), "platformNet".padStart(12)].join(" | "),
);
console.log("-".repeat(92));
console.log(row("$10 course (USD)", 1000, "USD"));
console.log(row("$50 course (USD)", 5000, "USD"));
console.log(row("$100 course (USD)", 10000, "USD"));
console.log(row("$200 course (USD)", 20000, "USD"));
console.log(row("$100 course (intl)", 10000, "BRL"));
console.log("-".repeat(92));
console.log(
  "\nRule: teacherNet = gross - platform(15%) - stripeFee" +
  "  |  platformNet ≈ full 15% (stripe fee passed to teacher)\n",
);

// ---- optional: real Stripe TEST API call ----
const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
if (key && key.startsWith("sk_test_")) {
  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 10000,
          product_data: { name: "Skillset E2E TEST course" },
        },
      }],
      success_url: "https://www.skillsetmind.com/?t=ok",
      cancel_url: "https://www.skillsetmind.com/?t=cancel",
    });
    console.log("LIVE-TEST mode: created TEST Checkout Session", session.id);
    console.log("Open to pay with 4242…:", session.url, "\n");
  } catch (e) {
    console.log("LIVE-TEST mode attempted but failed:", e.message, "\n");
  }
} else {
  console.log(
    "LIVE-TEST mode skipped: no sk_test_ key in env. " +
    "Set STRIPE_SECRET_KEY=sk_test_... to also create a real TEST session.\n",
  );
}

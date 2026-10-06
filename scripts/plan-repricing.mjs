#!/usr/bin/env node
/**
 * Repricing audit for the 3-plan change of 2026-10-06 (Starter $5 / 4.9%,
 * Pro 0%, Plus retired). DRY RUN by default, and it prints COUNTS ONLY: no
 * ids, emails, names or per-person amounts ever reach the terminal.
 *
 *   (a) student subscriptions to creator courses whose frozen
 *       application_fee_percent differs from the creator's current plan rate
 *       (Stripe freezes the percent at checkout; a Starter or Pro creator's
 *       older student subscriptions still pay the old rate);
 *   (b) creator plan subscriptions still on the old $19 / $190 Starter Prices;
 *   (c) live Plus subscriptions (report only: Plus is grandfathered);
 *   (d) creators on the internal free tier with at least one published
 *       product (report only: enforcement is a later change).
 *
 * --apply fixes (a) and (b):
 *   (a) sets each subscription's application_fee_percent to the creator's
 *       current rate on the creator's connected account (unset at 0%, since
 *       Stripe rejects a zero fee in some calls). Stripe applies it from the
 *       next invoice; the webhook books what the subscription states.
 *   (b) swaps the subscription item to the new Starter Price of the same
 *       cycle (lookup keys below), with Stripe's default proration.
 *
 * A live key needs --live on top of --apply. Do not run it against production
 * without the founder's go-ahead; run the dry run first and compare counts.
 *
 * Reads STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY from the environment only (no .env file is read).
 *
 *   node scripts/plan-repricing.mjs                 # dry run, counts
 *   node scripts/plan-repricing.mjs --apply         # test-mode key
 *   node scripts/plan-repricing.mjs --apply --live  # production, founder's call
 */
import { pathToFileURL } from "node:url";

// Mirrors canonicalPlatformFeeBpsForPlan in src/lib/payments/rules.ts
// (src/lib/payments/plan-repricing-script.test.ts fails if the two drift).
export const RATE_BPS = { free: 1000, starter: 490, pro: 0, plus: 200 };

// The $19 / $190 Starter Prices (legacyStripePriceIds in src/data/plans.ts).
export const OLD_STARTER_PRICES = {
  monthly: "price_1TZFTmPvg1vJW0IjLAYWqZok",
  yearly: "price_1TZFTnPvg1vJW0IjjaQXBpDW",
};
// The $5 / $50 Starter Prices, found by lookup key so this script does not
// depend on the IDs being pasted into plans.ts first.
export const NEW_STARTER_LOOKUP_KEYS = {
  monthly: "skillset_starter_monthly_2026_10",
  yearly: "skillset_starter_yearly_2026_10",
};
export const PLUS_PRICES = [
  "price_1TZFToPvg1vJW0Ijf35SQQzt",
  "price_1TZFTpPvg1vJW0IjgE9PQ5To",
];

const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const PAGE = 1000;

/** The percent Stripe should hold for a plan: null (no field) at 0%. */
export function expectedFeePercent(planId) {
  const bps = RATE_BPS[planId] ?? RATE_BPS.free;
  return bps > 0 ? bps / 100 : null;
}

/** Does a subscription's frozen percent differ from the plan's rate? */
export function feeDrifted(frozenPercent, planId) {
  const frozenBps = Math.round((typeof frozenPercent === "number" ? frozenPercent : 0) * 100);
  return frozenBps !== (RATE_BPS[planId] ?? RATE_BPS.free);
}

async function selectAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function listLiveByPrice(stripe, price) {
  const found = [];
  for await (const subscription of stripe.subscriptions.list({ price, status: "all", limit: 100 })) {
    if (LIVE_STATUSES.has(subscription.status)) found.push(subscription);
  }
  return found;
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  const apply = argv.has("--apply");
  const env = process.env;
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!/^(sk|rk)_(test|live)_/.test(key) || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Needs STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  const live = /^(sk|rk)_live_/.test(key);
  if (apply && live && !argv.has("--live")) {
    console.error("Live key with --apply: add --live to confirm this is a production run.");
    process.exit(1);
  }

  const { default: Stripe } = await import("stripe");
  const { createClient } = await import("@supabase/supabase-js");
  const stripe = new Stripe(key);
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log(`Mode: ${live ? "LIVE" : "TEST"} · ${apply ? "APPLY" : "DRY RUN (counts only)"}`);

  // (a) student subscriptions with a stale frozen fee --------------------------
  const courseSubs = await selectAll(() =>
    db.from("course_subscriptions")
      .select("stripe_subscription_id,teacher_id,status")
      .in("status", [...LIVE_STATUSES]),
  );
  const teacherIds = [...new Set(courseSubs.map((row) => row.teacher_id).filter(Boolean))];
  const teachers = new Map();
  for (let i = 0; i < teacherIds.length; i += 200) {
    const { data, error } = await db.from("users")
      .select("uid,current_plan_id,stripe_connected_account_id")
      .in("uid", teacherIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data) teachers.set(row.uid, row);
  }
  const a = { checked: 0, drifted: 0, fixed: 0, unreachable: 0 };
  for (const row of courseSubs) {
    const teacher = teachers.get(row.teacher_id);
    if (!row.stripe_subscription_id || !teacher?.stripe_connected_account_id) {
      a.unreachable += 1;
      continue;
    }
    const planId = teacher.current_plan_id ?? "free";
    const account = { stripeAccount: teacher.stripe_connected_account_id };
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id, undefined, account);
    } catch {
      // Lives on an older connected account, or is gone: count, never print.
      a.unreachable += 1;
      continue;
    }
    a.checked += 1;
    if (!feeDrifted(subscription.application_fee_percent, planId)) continue;
    a.drifted += 1;
    if (apply) {
      const percent = expectedFeePercent(planId);
      await stripe.subscriptions.update(
        subscription.id,
        { application_fee_percent: percent ?? "" },
        account,
      );
      a.fixed += 1;
    }
  }
  console.log(`(a) student subscriptions: ${a.checked} checked, ${a.drifted} with a fee different from the creator's plan, ${a.fixed} fixed, ${a.unreachable} not reachable`);

  // (b) creator subscriptions on the $19 Starter --------------------------------
  const b = { found: 0, moved: 0 };
  const newPrices = {};
  if (apply) {
    const { data } = await stripe.prices.list({
      lookup_keys: Object.values(NEW_STARTER_LOOKUP_KEYS),
      active: true,
    });
    for (const [cycle, lookupKey] of Object.entries(NEW_STARTER_LOOKUP_KEYS)) {
      newPrices[cycle] = data.find((price) => price.lookup_key === lookupKey)?.id;
    }
    if (!newPrices.monthly || !newPrices.yearly) {
      console.error("The new Starter Prices are not in this Stripe account yet (lookup keys skillset_starter_*_2026_10). Nothing moved.");
      process.exit(1);
    }
  }
  for (const [cycle, oldPrice] of Object.entries(OLD_STARTER_PRICES)) {
    for (const subscription of await listLiveByPrice(stripe, oldPrice)) {
      b.found += 1;
      if (!apply) continue;
      const item = subscription.items.data.find((candidate) => candidate.price.id === oldPrice);
      // Default proration: Stripe credits the unused part of the old price.
      await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: newPrices[cycle] }],
      });
      b.moved += 1;
    }
  }
  console.log(`(b) creator subscriptions on the $19/$190 Starter: ${b.found} found, ${b.moved} moved to $5/$50`);

  // (c) Plus, report only ---------------------------------------------------------
  let plus = 0;
  for (const price of PLUS_PRICES) plus += (await listLiveByPrice(stripe, price)).length;
  console.log(`(c) live Plus subscriptions (grandfathered, untouched): ${plus}`);

  // (d) free tier with a published product, report only -----------------------------
  const published = await selectAll(() =>
    db.from("courses").select("owner_id").eq("status", "published"),
  );
  const owners = [...new Set(published.map((row) => row.owner_id).filter(Boolean))];
  let freeWithProduct = 0;
  for (let i = 0; i < owners.length; i += 200) {
    const { data, error } = await db.from("users")
      .select("current_plan_id")
      .in("uid", owners.slice(i, i + 200));
    if (error) throw new Error(error.message);
    freeWithProduct += data.filter((row) => (row.current_plan_id ?? "free") === "free").length;
  }
  console.log(`(d) creators on the internal free tier with a published product: ${freeWithProduct}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Message only: a Stripe error object can carry request details.
    console.error(`Failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}

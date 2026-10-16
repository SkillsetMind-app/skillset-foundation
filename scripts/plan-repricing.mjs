#!/usr/bin/env node
/**
 * Repricing audit for the price table of 2026-10-06 (Basic 10%, Starter 4.9%,
 * Pro 2.9%, Enterprise 1.9%, each + a fixed ~US$0.30 per sale; no free plan,
 * a 14-day trial instead). DRY RUN by default, and it prints COUNTS ONLY: no
 * ids, emails, names or per-person amounts ever reach the terminal.
 *
 *   (a) student subscriptions created before the fixed fee whose frozen
 *       application_fee_percent differs from the creator's current plan rate.
 *       Once invoice.created is enabled on the Connect webhook, every renewal
 *       is charged the exact current fee anyway; the frozen percent is only
 *       the fallback if that webhook ever fails;
 *   (b) creators on Enterprise (id `plus`, ex-Plus) with a live subscription
 *       (report only: they move from 2% to 1.9% + the fixed fee automatically);
 *   (c) creators with no plan (internal `free`) and at least one published
 *       product (report only: blocking them is the enforcement change).
 *
 * --apply fixes (a): sets each such subscription's application_fee_percent to
 * the creator's current plan percent, on the creator's connected account.
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
export const RATE_BPS = { free: 1000, basic: 1000, starter: 490, pro: 290, plus: 190 };

// Enterprise's Prices (the old Plus Prices, src/data/plans.ts).
export const ENTERPRISE_PRICES = [
  "price_1TZFToPvg1vJW0Ijf35SQQzt",
  "price_1TZFTpPvg1vJW0IjgE9PQ5To",
];

const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const PAGE = 1000;

/** The percent a pre-fixed-fee subscription should hold for a plan. */
export function expectedFeePercent(planId) {
  return (RATE_BPS[planId] ?? RATE_BPS.free) / 100;
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
    // Created with the fixed fee: its percent already folds the fixed part in.
    if (subscription.metadata?.platformFeeFixedMinor !== undefined) continue;
    a.checked += 1;
    if (!feeDrifted(subscription.application_fee_percent, planId)) continue;
    a.drifted += 1;
    if (apply) {
      await stripe.subscriptions.update(
        subscription.id,
        { application_fee_percent: expectedFeePercent(planId) },
        account,
      );
      a.fixed += 1;
    }
  }
  console.log(`(a) student subscriptions from before the fixed fee: ${a.checked} checked, ${a.drifted} with a percent different from the creator's plan, ${a.fixed} fixed, ${a.unreachable} not reachable`);

  // (b) Enterprise, report only -------------------------------------------------
  let enterprise = 0;
  for (const price of ENTERPRISE_PRICES) {
    for await (const subscription of stripe.subscriptions.list({ price, status: "all", limit: 100 })) {
      if (LIVE_STATUSES.has(subscription.status)) enterprise += 1;
    }
  }
  console.log(`(b) live Enterprise (ex-Plus) subscriptions: ${enterprise}`);

  // (c) no plan, with a published product, report only ---------------------------
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
  console.log(`(c) creators with no plan and a published product: ${freeWithProduct}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Message only: a Stripe error object can carry request details.
    console.error(`Failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}

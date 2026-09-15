import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/stripe-attention — tells a human when a Stripe event did not
// finish processing, i.e. when someone may have paid without getting access.
// Until now that student was found only when they complained.
//
// Called every hour by .github/workflows/stripe-attention.yml with the same
// "Bearer CRON_SECRET" header Vercel Cron sends (Hobby plan crons run at most
// once a day, so the hourly tick comes from GitHub).
//
// Anti-spam, with no state between runs:
//   - alert when at least one event entered the list in the last 2 hours
//     (an event enters 15 min after its claim, see the view). Runs are hourly,
//     so a new stuck event is reported on 1-2 runs; 2 h instead of 1 h keeps a
//     late or skipped GitHub run from losing it;
//   - otherwise, one reminder a day at 12:00 UTC while the list is not empty.
// Everything else stays silent. The alert carries the count and the oldest
// age only: no event id, no email, no amount.
//
// When there IS something to report and nobody could be told (no relay URL,
// relay down, relay refused), the answer is 500: the GitHub run turns red and
// its failure email is the second channel. A green run means a human was told
// or there was nothing to tell.

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const NEW_WINDOW_MS = 2 * HOUR_MS + 15 * 60 * 1000;
const REMINDER_UTC_HOUR = 12;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let admin;
  try {
    // Service role: the view is closed to anon/authenticated on purpose.
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 500 });
  }

  // ponytail: the view is not in the generated types (Views is empty there);
  // reading the view keeps its 15-minute rule in one place instead of copying it.
  const { data, error } = await (admin as unknown as SupabaseClient)
    .from("stripe_events_needing_attention")
    .select("claimed_at");
  if (error) {
    // A check that cannot see is not a green check: 500 turns the run red.
    console.error("Stripe attention check could not read the view", error.message);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 500 });
  }

  const claims = ((data ?? []) as { claimed_at: string }[]).map((row) => Date.parse(row.claimed_at));
  if (claims.length === 0) {
    return NextResponse.json({ ok: true, count: 0, alerted: false });
  }

  const now = Date.now();
  const count = claims.length;
  const oldestHours = Math.floor((now - Math.min(...claims)) / HOUR_MS);
  const reason = Math.max(...claims) > now - NEW_WINDOW_MS ? "new"
    : new Date(now).getUTCHours() === REMINDER_UTC_HOUR ? "daily"
    : null;

  if (!reason) {
    return NextResponse.json({ ok: true, count, oldest_hours: oldestHours, alerted: false });
  }

  const failure = !process.env.OPS_ALERT_WEBHOOK_URL ? "alert_channel_missing"
    : await sendOpsAlert({
      event: "stripe.events.needing_attention",
      severity: "critical",
      summary: `${count} Stripe event(s) did not finish processing; the oldest is ${oldestHours} h old. Someone may have paid without getting access. Check the stripe_events_needing_attention view.`,
      context: { count, oldest_hours: oldestHours, reason },
    }) ? null
    : "alert_not_delivered";

  if (failure) {
    console.error("Stripe attention alert did not reach anyone", failure);
    return NextResponse.json(
      { ok: false, reason: failure, count, oldest_hours: oldestHours, alerted: false },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, count, oldest_hours: oldestHours, alerted: true });
}

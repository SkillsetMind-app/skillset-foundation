import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/ops-inbox — tells a human when something is waiting for staff:
// a support ticket, a community report, or a creator verification. All three
// are written straight from the browser into Supabase, so until now staff
// only saw them by opening /ops.
//
// Same shape and anti-spam as /api/cron/stripe-attention, called by the same
// hourly workflow (.github/workflows/stripe-attention.yml), no state between
// runs:
//   - alert when at least one item arrived in the last 2 h 15 min (runs are
//     hourly; the slack keeps a late or skipped GitHub run from losing it);
//   - otherwise, one reminder a day at 12:00 UTC while anything is still open.
//
// Only ids and timestamps are read, and only counts, the oldest age and at
// most 5 row uuids per kind leave the building: no email, name, subject or
// message body can reach the alert.
//
// Something to report and nobody could be told → 500, so the GitHub run turns
// red and its failure email is the second channel.

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const NEW_WINDOW_MS = 2 * HOUR_MS + 15 * 60 * 1000;
const REMINDER_UTC_HOUR = 12;
const MAX_IDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Open" = still needs staff. `at` is the moment a human should look again:
// a verification resubmitted after "needs changes" goes back to pending with a
// fresh updated_at, so it counts as new even though created_at is old.
// ponytail: created_at on tickets and reports is written by the browser at
// insert, so a user could backdate theirs past the "new" window; it still
// shows in the daily reminder. A server-side default on insert closes that.
const QUEUES = [
  { kind: "tickets", table: "support_tickets", statuses: ["open", "in_review"], at: "created_at" },
  { kind: "reports", table: "community_reports", statuses: ["open"], at: "created_at" },
  { kind: "verifications", table: "creator_verification_cases", statuses: ["pending"], at: "updated_at" },
] as const;

type Kind = (typeof QUEUES)[number]["kind"];
type Item = { id: string; at: number };

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 500 });
  }

  // ponytail: untyped client so one loop covers three tables; the select is
  // two columns per table and the tests pin them.
  const client = admin as unknown as SupabaseClient;
  const results = await Promise.all(
    QUEUES.map((queue) => client.from(queue.table).select(`id, ${queue.at}`).in("status", [...queue.statuses])),
  );

  const open = {} as Record<Kind, Item[]>;
  for (const [index, queue] of QUEUES.entries()) {
    const { data, error } = results[index];
    if (error) {
      // A check that cannot see is not a green check.
      console.error("Ops inbox check could not read", queue.table, error.message);
      return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 500 });
    }
    open[queue.kind] = ((data ?? []) as Record<string, string | null>[]).map((row) => ({
      id: String(row.id),
      at: Date.parse(row[queue.at] ?? ""),
    }));
  }

  const now = Date.now();
  const counts = (pick: (item: Item) => boolean) => ({
    tickets: open.tickets.filter(pick).length,
    reports: open.reports.filter(pick).length,
    verifications: open.verifications.filter(pick).length,
  });
  const total = counts(() => true);
  const fresh = counts((item) => item.at > now - NEW_WINDOW_MS);

  if (total.tickets + total.reports + total.verifications === 0) {
    return NextResponse.json({ ok: true, open: total, alerted: false });
  }

  const times = Object.values(open).flat().map((item) => item.at).filter(Number.isFinite);
  const oldestHours = times.length ? Math.max(0, Math.floor((now - Math.min(...times)) / HOUR_MS)) : null;
  const reason = fresh.tickets + fresh.reports + fresh.verifications > 0 ? "new"
    : new Date(now).getUTCHours() === REMINDER_UTC_HOUR ? "daily"
    : null;
  const result = { open: total, new: fresh, oldest_hours: oldestHours };

  if (!reason) {
    return NextResponse.json({ ok: true, ...result, alerted: false });
  }

  const shown = reason === "new" ? fresh : total;
  const lead = reason === "new" ? `${shown.tickets} new support ticket(s)` : `Still open: ${shown.tickets} support ticket(s)`;
  // Newest first, uuids only: an id that is not a uuid is dropped, never sent.
  const ids = (kind: Kind) =>
    [...open[kind]].sort((a, b) => (b.at || 0) - (a.at || 0)).map((item) => item.id).filter((id) => UUID.test(id))
      .slice(0, MAX_IDS).join(",");

  const failure = !process.env.OPS_ALERT_WEBHOOK_URL ? "alert_channel_missing"
    : await sendOpsAlert({
      event: "ops.inbox.new",
      severity: "warn",
      summary: `${lead}, ${shown.reports} report(s), ${shown.verifications} verification(s) waiting. Oldest open: ${oldestHours ?? "?"} h. Open /ops.`,
      context: {
        reason,
        oldest_hours: oldestHours,
        tickets_new: fresh.tickets,
        reports_new: fresh.reports,
        verifications_new: fresh.verifications,
        tickets_open: total.tickets,
        reports_open: total.reports,
        verifications_open: total.verifications,
        ticket_ids: ids("tickets"),
        report_ids: ids("reports"),
        verification_ids: ids("verifications"),
      },
    }) ? null
    : "alert_not_delivered";

  if (failure) {
    console.error("Ops inbox alert did not reach anyone", failure);
    return NextResponse.json({ ok: false, reason: failure, ...result, alerted: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...result, alerted: true });
}

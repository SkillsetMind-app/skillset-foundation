import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/cron/authorized";
import { sendOpsAlert } from "@/lib/ops/alert";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/ops-inbox — tells a human when something is waiting for staff:
// a support ticket, a community report, a creator verification, or a privacy
// request (account deletion / data export, which runs on a 30-day clock).
// None of them notified anyone, so until now staff only saw them by opening /ops.
//
// Same shape and anti-spam as /api/cron/stripe-attention, called by the same
// hourly workflow (.github/workflows/stripe-attention.yml), no state between
// runs:
//   - alert when at least one item arrived in the last 70 min: runs are hourly,
//     so each item alerts once (twice only if it lands in the 10 min of slack
//     before a run). A run more than 10 min late can miss an item's own "new"
//     alert, so every "new" alert also carries the open totals, and the daily
//     reminder lists everything still open;
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
const NEW_WINDOW_MS = 70 * 60 * 1000;
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
  // requested_at is set by the request_account_action RPC, not the browser.
  { kind: "privacy", table: "account_action_requests", statuses: ["pending", "processing"], at: "requested_at" },
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

  // ponytail: untyped client so one loop covers every table; the select is
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
    privacy: open.privacy.filter(pick).length,
  });
  const sum = (count: Record<Kind, number>) => Object.values(count).reduce((a, b) => a + b, 0);
  const total = counts(() => true);
  const fresh = counts((item) => item.at > now - NEW_WINDOW_MS);

  if (sum(total) === 0) {
    return NextResponse.json({ ok: true, open: total, alerted: false });
  }

  const times = Object.values(open).flat().map((item) => item.at).filter(Number.isFinite);
  const oldestHours = times.length ? Math.max(0, Math.floor((now - Math.min(...times)) / HOUR_MS)) : null;
  const reason = sum(fresh) > 0 ? "new"
    : new Date(now).getUTCHours() === REMINDER_UTC_HOUR ? "daily"
    : null;
  const result = { open: total, new: fresh, oldest_hours: oldestHours };

  if (!reason) {
    return NextResponse.json({ ok: true, ...result, alerted: false });
  }

  const list = (count: Record<Kind, number>) =>
    `${count.tickets} support ticket(s), ${count.reports} report(s), ${count.verifications} verification(s), ${count.privacy} privacy request(s)`;
  // A "new" alert also carries the open totals: an item whose own "new" alert
  // was lost to a late or skipped run still shows up in the next one.
  const countsLine = reason === "new" ? `New: ${list(fresh)}. Open in total: ${list(total)}.` : `Still open: ${list(total)} waiting.`;
  // Newest first, uuids only: an id that is not a uuid is dropped, never sent.
  const ids = (kind: Kind) =>
    [...open[kind]].sort((a, b) => (b.at || 0) - (a.at || 0)).map((item) => item.id).filter((id) => UUID.test(id))
      .slice(0, MAX_IDS).join(",");

  const failure = !process.env.OPS_ALERT_WEBHOOK_URL ? "alert_channel_missing"
    : await sendOpsAlert({
      event: "ops.inbox.new",
      severity: "warn",
      summary: `${countsLine} Oldest open: ${oldestHours ?? "?"} h. Open /ops.`,
      context: {
        reason,
        oldest_hours: oldestHours,
        tickets_new: fresh.tickets,
        reports_new: fresh.reports,
        verifications_new: fresh.verifications,
        privacy_new: fresh.privacy,
        tickets_open: total.tickets,
        reports_open: total.reports,
        verifications_open: total.verifications,
        privacy_open: total.privacy,
        ticket_ids: ids("tickets"),
        report_ids: ids("reports"),
        verification_ids: ids("verifications"),
        privacy_ids: ids("privacy"),
      },
    }) ? null
    : "alert_not_delivered";

  if (failure) {
    console.error("Ops inbox alert did not reach anyone", failure);
    return NextResponse.json({ ok: false, reason: failure, ...result, alerted: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...result, alerted: true });
}

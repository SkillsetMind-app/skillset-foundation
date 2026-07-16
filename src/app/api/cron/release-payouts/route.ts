import { NextResponse } from "next/server";

import { normalizeSkillsetCurrency } from "@/lib/payments/currencies";
import {
  createReleasedRefundTransferReversal,
  plannedReleaseTransferAmountMinor,
  type TransferReversalStripeClient,
} from "@/lib/payments/rules";
import { getStripeClient, isStripeConfigured } from "@/lib/payments/server/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/release-payouts — the teacher-payout release engine. Faithful
// Supabase-native port of the dailyReleaseTransfers Firebase scheduled function
// (functions/src/index.ts). It moves each cleared payout from the platform
// balance to the teacher's connected account:
//
//   payout_ledger(status=in_release, release_at<=now)
//     -> claim (in_release -> releasing, atomic single-row UPDATE)
//     -> stripe.transfers.create (idempotencyKey transfer_<ledgerId>)
//     -> settle (releasing -> released, records transfer_id)
//
// The 30-day hold (payoutReleaseDelayDays, written as release_at by the webhook)
// sits comfortably past the 7-day student refund window, so a cleared payout
// never predates a still-refundable charge — the Hotmart/Kiwify model.
//
// Money safety:
//  - The Stripe idempotency key transfer_<ledgerId> makes every retry of the
//    SAME ledger a replay, never a repeat: Stripe creates the transfer exactly
//    once even if this route runs twice or crashes mid-flight.
//  - The atomic claim (WHERE status='in_release') lets only one worker flip a
//    given ledger to 'releasing', so overlapping runs never double-pay.
//  - A refund that races in AFTER transfers.create (settle finds status no
//    longer 'releasing') triggers an immediate proportional reversal so the
//    platform never pays out money it no longer holds.
//  - A recovery sweep resets any ledger stuck in 'releasing' > 6h (a prior run
//    died between claim and settle) back to 'in_release' for a safe retry.
//
// Dormant by default: rejects every request until CRON_SECRET is set, and
// returns 503 until Stripe is configured — so shipping this route changes
// nothing in production until the founder enables payouts. Vercel Cron calls it
// with `Authorization: Bearer <CRON_SECRET>`; any scheduler (e.g. n8n) that
// sends the same header works identically.

export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

const CLAIM_BATCH = 50;
const STALE_RELEASING_MS = 6 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

type LedgerRow = {
  id: string;
  status: string;
  teacher_stripe_connected_account_id: string | null;
  currency: string;
  gross_amount_minor: number;
  net_amount_minor: number;
  refunded_amount_minor: number;
  planned_transfer_amount_minor: number | null;
  transfer_reversed_amount_minor: number;
  order_id: string | null;
  course_id: string | null;
  teacher_id: string;
  payment_id: string | null;
};

const LEDGER_COLUMNS =
  "id,status,teacher_stripe_connected_account_id,currency,gross_amount_minor," +
  "net_amount_minor,refunded_amount_minor,planned_transfer_amount_minor," +
  "transfer_reversed_amount_minor,order_id,course_id,teacher_id,payment_id";

// Reset ledgers stuck in 'releasing' longer than the stale window: a prior run
// died between claiming and settling. The Stripe transfer is idempotent under
// transfer_<ledgerId>, so re-arming to 'in_release' is safe — Stripe replays the
// answer it already gave or creates the transfer exactly once.
async function recoverStuckReleases(admin: Admin): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RELEASING_MS).toISOString();
  const { data } = await admin
    .from("payout_ledger")
    .update({ status: "in_release", updated_at: nowIso() })
    .eq("status", "releasing")
    .lt("updated_at", staleBefore)
    .select("id");
  return data?.length ?? 0;
}

// Atomically claim a due ledger (in_release -> releasing). The refund predicate
// makes the selection snapshot part of the compare-and-swap: if a refund lands
// before this UPDATE, no row is claimed and the next run selects the new state.
// The first winning claim freezes the amount while that exact refund state is
// current. Retries reuse that persisted amount because the Stripe idempotency
// key is stable for the ledger and therefore its request parameters must be too.
async function claimLedger(
  admin: Admin,
  ledger: LedgerRow,
): Promise<LedgerRow | null> {
  const selectedRefundedAmount = Number(ledger.refunded_amount_minor ?? 0);
  const { data: claimed, error: claimError } = await admin
    .from("payout_ledger")
    .update({
      status: "releasing",
      updated_at: nowIso(),
    })
    .eq("id", ledger.id)
    .eq("status", "in_release")
    .eq("refunded_amount_minor", selectedRefundedAmount)
    .lte("release_at", nowIso())
    .select(LEDGER_COLUMNS)
    .maybeSingle();

  if (claimError) throw new Error(claimError.message);
  if (!claimed) return null;

  const claimedLedger = claimed as unknown as LedgerRow;
  const claimedRefundedAmount = Number(
    claimedLedger.refunded_amount_minor ?? 0,
  );
  const planned =
    claimedLedger.planned_transfer_amount_minor ??
    plannedReleaseTransferAmountMinor({
      netAmountMinor: claimedLedger.net_amount_minor,
      grossAmountMinor: claimedLedger.gross_amount_minor,
      refundedAmountMinor: claimedRefundedAmount,
    });

  const { data: frozen, error: freezeError } = await admin
    .from("payout_ledger")
    .update({
      planned_transfer_amount_minor: planned,
      updated_at: nowIso(),
    })
    .eq("id", claimedLedger.id)
    .eq("status", "releasing")
    .eq("refunded_amount_minor", claimedRefundedAmount)
    .select(LEDGER_COLUMNS)
    .maybeSingle();

  if (freezeError) throw new Error(freezeError.message);
  return (frozen as LedgerRow | null) ?? null;
}

async function releaseClaimedLedger(
  admin: Admin,
  ledger: LedgerRow,
): Promise<"released" | "reversed_race"> {
  const amount = Number(
    ledger.planned_transfer_amount_minor ?? ledger.net_amount_minor ?? 0,
  );
  const ts = nowIso();

  // Fully refunded before release: nothing to move. Record a zero transfer so a
  // later refund's reversal math sees no money left the platform.
  if (amount <= 0) {
    await admin
      .from("payout_ledger")
      .update({
        status: "released",
        transfer_id: null,
        transfer_amount_minor: 0,
        updated_at: ts,
      })
      .eq("id", ledger.id)
      .eq("status", "releasing");
    return "released";
  }

  const destination = ledger.teacher_stripe_connected_account_id;
  if (!destination) {
    // Re-arm and skip: a payout with no connected account can't move. Surfaces
    // as an error-level log so a misconfigured teacher payout doesn't fail
    // silently forever.
    await admin
      .from("payout_ledger")
      .update({ status: "in_release", updated_at: ts })
      .eq("id", ledger.id)
      .eq("status", "releasing");
    throw new Error(`Ledger ${ledger.id} has no connected account.`);
  }

  const stripe = getStripeClient();
  const transfer = await stripe.transfers.create(
    {
      amount,
      currency: normalizeSkillsetCurrency(ledger.currency).toLowerCase(),
      destination,
      description: `SkillsetMind course payout ${ledger.order_id ?? ledger.id}`,
      metadata: {
        ledgerId: ledger.id,
        orderId: String(ledger.order_id ?? ""),
        courseId: String(ledger.course_id ?? ""),
        teacherId: ledger.teacher_id,
        paymentId: String(ledger.payment_id ?? ""),
      },
    },
    { idempotencyKey: `transfer_${ledger.id}` },
  );

  // Settle. Conditional on status still 'releasing': if a refund raced in and
  // flipped the ledger to refunded/partially_refunded while the transfer was in
  // flight, this UPDATE matches 0 rows — we then record the transfer that did
  // happen and reverse it, because the buyer's money was returned.
  const { data: settled } = await admin
    .from("payout_ledger")
    .update({
      status: "released",
      transfer_id: transfer.id,
      transfer_amount_minor: amount,
      updated_at: nowIso(),
    })
    .eq("id", ledger.id)
    .eq("status", "releasing")
    .select("id")
    .maybeSingle();

  if (settled) return "released";

  // Refund raced the release. Persist the transfer, then reverse the portion the
  // refund covers so the platform doesn't pay out refunded money.
  await admin
    .from("payout_ledger")
    .update({
      transfer_id: transfer.id,
      transfer_amount_minor: amount,
      updated_at: nowIso(),
    })
    .eq("id", ledger.id);

  const { data: fresh } = await admin
    .from("payout_ledger")
    .select(
      "gross_amount_minor,net_amount_minor,refunded_amount_minor,transfer_reversed_amount_minor",
    )
    .eq("id", ledger.id)
    .maybeSingle();

  const alreadyReversed = Number(fresh?.transfer_reversed_amount_minor ?? 0);
  const { reversalId, reversalAmountMinor } =
    await createReleasedRefundTransferReversal({
      stripe: stripe as unknown as TransferReversalStripeClient,
      ledgerId: ledger.id,
      transferId: transfer.id,
      grossAmountMinor: Number(fresh?.gross_amount_minor ?? ledger.gross_amount_minor),
      refundedAmountMinor: Number(fresh?.refunded_amount_minor ?? 0),
      releasedTransferAmountMinor: amount,
      netAmountMinor: Number(fresh?.net_amount_minor ?? ledger.net_amount_minor),
      alreadyReversedAmountMinor: alreadyReversed,
      idempotencyKey: `reversal_release_race_${ledger.id}`,
      metadata: {
        orderId: String(ledger.order_id ?? ""),
        courseId: String(ledger.course_id ?? ""),
        teacherId: ledger.teacher_id,
        reason: "refund_raced_release",
      },
    });

  if (reversalAmountMinor > 0) {
    await admin
      .from("payout_ledger")
      .update({
        transfer_reversed_amount_minor: alreadyReversed + reversalAmountMinor,
        ...(reversalId
          ? { latest_transfer_reversal_id: reversalId, latest_transfer_reversal_at: nowIso() }
          : {}),
        updated_at: nowIso(),
      })
      .eq("id", ledger.id);
  }

  return "reversed_race";
}

export async function GET(request: Request) {
  // Dormant until the founder enables payouts: reject every call unless the
  // shared CRON_SECRET matches (Vercel Cron sends it as a Bearer token).
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured.", code: "payments_not_configured" },
      { status: 503 },
    );
  }

  const admin = getSupabaseAdminClient();

  let released = 0;
  let reversedRace = 0;
  let skipped = 0;
  let failed = 0;
  let recovered = 0;

  try {
    recovered = await recoverStuckReleases(admin);

    const { data: due, error } = await admin
      .from("payout_ledger")
      .select(LEDGER_COLUMNS)
      .eq("status", "in_release")
      .lte("release_at", nowIso())
      .limit(CLAIM_BATCH);
    if (error) throw new Error(error.message);

    for (const row of (due ?? []) as unknown as LedgerRow[]) {
      const claimed = await claimLedger(admin, row);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      try {
        const outcome = await releaseClaimedLedger(admin, claimed);
        if (outcome === "released") released += 1;
        else reversedRace += 1;
      } catch (err) {
        failed += 1;
        // Re-arm so the next run retries (idempotency key keeps it money-safe).
        await admin
          .from("payout_ledger")
          .update({ status: "in_release", updated_at: nowIso() })
          .eq("id", claimed.id)
          .eq("status", "releasing");
        console.error("Payout release failed", { ledgerId: claimed.id, err });
      }
    }
  } catch (err) {
    console.error("Payout release run failed", err);
    return NextResponse.json({ error: "Release run failed." }, { status: 500 });
  }

  const summary = { released, reversedRace, skipped, failed, recovered };
  if (failed > 0) console.error("Payout release finished with failures", summary);
  return NextResponse.json({ ok: true, ...summary });
}

# Phase 2 Summary 02 - Subscription financial facts

## Delivered

- Each `invoice.paid` course renewal now creates deterministic `orders` and `payments` records before its payout ledger entry.
- Insert-only upserts recover partial webhook attempts without overwriting later refund state.
- Ledger insert failures now fail the event so Stripe can redeliver it.
- Self-service refunds accept subscription enrollments and target the latest paid renewal.
- Full subscription-invoice refunds cancel recurring billing idempotently; partial refunds keep the subscription active.
- Subscription refunds no longer apply the one-time-purchase `refunded` enrollment transition. Stripe subscription lifecycle events own access revocation.

## Verification

- Focused payment tests: 19 passed.
- Full Vitest suite: 35 files, 180 tests passed.
- TypeScript: passed.
- ESLint: passed.
- Diff whitespace check: passed.

## Residual work

- Backfill already-processed historical invoices; the webhook repair path covers new events and redeliveries only.
- Replay real Stripe fixtures against a reproducible Supabase environment after management access is available.
- Build subscriber operations and MRR/churn reporting in subsequent Phase 2 slices.

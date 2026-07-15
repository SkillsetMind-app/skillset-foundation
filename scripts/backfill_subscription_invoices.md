# Backfill historical subscription invoices → orders/payments

**Status:** BLOCKED (needs Skillset `STRIPE_SECRET_KEY` + `SUPABASE_SERVICE_ROLE_KEY`)  
**Depends on:** webhook path that materializes order/payment on `invoice.paid` (`#6`)

## Why

Completed Stripe events are claimed in `processed_stripe_events` and intentionally short-circuit redelivery. Historical renewals that ran before the materialization fix never create `orders`/`payments`, so sales reports undercount recurring revenue.

## Safe procedure (when keys exist)

1. Put Skillset keys in `projects/skillset-foundation/.env.local` (not Lugano vault keys).
2. Dry-run list:
   ```bash
   # pseudocode — implement with Stripe API list invoices
   stripe invoices list --status=paid --limit=100
   # filter: subscription != null AND metadata.course_id present
   ```
3. For each invoice without matching `orders.stripe_invoice_id` (or equivalent):
   - Re-invoke the **same** materialization function used by the webhook (do not invent a second path).
   - Mark a backfill claim row so re-runs are idempotent.
4. Never delete ledger rows; insert-only orders/payments.

## Credentials map (names only)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | List invoices / retrieve subscription |
| `SUPABASE_SERVICE_ROLE_KEY` | Insert orders/payments/ledger repair |
| `NEXT_PUBLIC_SUPABASE_URL` | API host |

Vault `Todas as APIs Oficial.env` currently has Stripe **webhook** secret/id and **Lugano** Supabase — not enough for Skillset backfill.

## Exit criteria

- [ ] Dry-run count of missing materializations documented
- [ ] Script reuses webhook materialization helper
- [ ] Idempotent second run creates zero new orders
- [ ] Vitest for helper remains green

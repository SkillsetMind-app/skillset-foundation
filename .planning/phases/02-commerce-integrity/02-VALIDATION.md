# Phase 2 Validation

## Automated matrix

| Requirement | Test | Status |
|---|---|---|
| COM-01 | Product format controls render Course, Subscription, and Free | Passed |
| COM-02 | Monthly/yearly create the matching payment type and open Pricing | Passed |
| COM-02 | Free creates `free` and opens Curriculum | Passed |
| COM-03 | Complete Supabase order row preserves authorization and financial fields | Passed |
| SUB-01 | Recurring invoice maps deterministically to canonical order and payment facts | Passed |
| SUB-01 | Order/payment precede the payout ledger and ledger errors trigger redelivery | Passed |
| SUB-02 | Payment and subscription enrollment sources are refundable | Passed |
| SUB-02 | Full recurring refund cancels once; partial refund keeps billing active | Passed |
| SUB-02 | Recurring refund does not apply one-time enrollment revocation | Passed |
| Regression | Full Vitest suite | 180/180 passed |
| Static correctness | TypeScript and ESLint | Passed |
| Production compatibility | Next.js production build | Passed |

## Visual matrix

| Viewport | Checks | Evidence |
|---|---|---|
| 1440x1100 | Three formats, active subscription, monthly/yearly control, form fit | `evidence/subscription-creation-desktop.png` |
| 390x844 | Stacked cards, readable controls, no overlap/overflow, reachable CTA | `evidence/subscription-creation-mobile.png` |

## Remaining phase gates

- Reproduce production schema/RPCs from versioned migrations.
- Replay recurring invoice idempotency against live Stripe test fixtures.
- Backfill historical invoices whose webhook event is already marked done.
- Reconcile charge, refund, reversal, and payout totals.
- Exercise creator subscriber controls and report metrics end to end.

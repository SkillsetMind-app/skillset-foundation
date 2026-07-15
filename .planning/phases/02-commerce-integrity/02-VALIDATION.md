# Phase 2 Validation

## Automated matrix

| Requirement | Test | Status |
|---|---|---|
| COM-01 | Product format controls render Course, Subscription, and Free | Passed |
| COM-02 | Monthly/yearly create the matching payment type and open Pricing | Passed |
| COM-02 | Free creates `free` and opens Curriculum | Passed |
| COM-03 | Complete Supabase order row preserves authorization and financial fields | Passed |
| Regression | Full Vitest suite | 173/173 passed |
| Static correctness | TypeScript and ESLint | Passed |
| Production compatibility | Next.js production build | Passed |

## Visual matrix

| Viewport | Checks | Evidence |
|---|---|---|
| 1440x1100 | Three formats, active subscription, monthly/yearly control, form fit | `evidence/subscription-creation-desktop.png` |
| 390x844 | Stacked cards, readable controls, no overlap/overflow, reachable CTA | `evidence/subscription-creation-mobile.png` |

## Remaining phase gates

- Reproduce production schema/RPCs from versioned migrations.
- Verify recurring invoice idempotency across replayed Stripe events.
- Reconcile charge, refund, reversal, and payout totals.
- Exercise creator subscriber controls and report metrics end to end.

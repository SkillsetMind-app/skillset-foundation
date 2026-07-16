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
| UI-01 | Advisor is the only global support action | Passed |
| UI-01 | Contextual help drawer closes on Escape/outside click and restores focus | Passed |
| UI-02 | Active producer navigation keeps stable 50px row height | Passed |
| PUB-01 | Approved professional publishes directly after deterministic checks | Passed in disposable PostgreSQL smoke test |
| PUB-01 | Pending professional verification blocks publication | Passed in disposable PostgreSQL smoke test |
| SEC-01 | Rate-limit RPC is service-role-only; server routes use the admin client | Passed |
| PAY-01 | Payout retry reuses the persisted amount for the same Stripe idempotency key | Passed |
| PAY-02 | Concurrent partial refunds reserve only the cumulative transfer reversal delta | Passed |
| WEB-01 | Critical webhook writes fail the event for safe redelivery | Passed |
| OFF-01 | Offer, price, and default synchronization commit atomically | Passed |
| SUB-03 | One blocking course subscription per learner/course is enforced | Passed |
| Database hardening | Migration applies, reapplies, and passes transactional smoke | Passed in disposable PostgreSQL 18 |
| Regression | Full Vitest suite | 266/266 passed across 54 files |
| Static correctness | TypeScript and ESLint | Passed |
| Production compatibility | Next.js production build | Passed |
| Candidate deployment | Vercel deployment is Ready; root returns 200; no immediate runtime errors | [skillset-foundation-1j23w5nfq-patrick-simons-projects.vercel.app](https://skillset-foundation-1j23w5nfq-patrick-simons-projects.vercel.app) |

## Visual matrix

| Viewport | Checks | Evidence |
|---|---|---|
| 1440x1100 | Three formats, active subscription, monthly/yearly control, form fit | `evidence/subscription-creation-desktop.png` |
| 390x844 | Stacked cards, readable controls, no overlap/overflow, reachable CTA | `evidence/subscription-creation-mobile.png` |
| 1440x900 | One global Advisor, stable active row, 420px contextual drawer | `evidence/issue-10-shell-desktop.png`, `evidence/issue-10-shell-help-open.png` |
| 390x844 | One global Advisor, full-width contextual drawer, no horizontal overflow | `evidence/issue-10-shell-mobile.png` |
| 1440x1000 | Short creation form and collapsed eight-option category picker | `evidence/issue-10-creation-desktop.png`, `evidence/issue-10-creation-categories-open.png` |
| 390x844 | Creation fields and actions fit without overlap or horizontal overflow | `evidence/issue-10-creation-mobile.png` |

## Remaining phase gates

- Authenticate the Supabase CLI/dashboard against the Skillset project and apply the five new migrations before promoting the candidate to `skillsetmind.com`.
- Replace the approximate type-derived baseline with a real schema-only dump from the Skillset database.
- Replay recurring invoice idempotency against live Stripe test fixtures.
- Backfill historical invoices whose webhook event is already marked done.
- Reconcile charge, refund, reversal, and payout totals.
- Exercise creator subscriber controls and report metrics end to end.

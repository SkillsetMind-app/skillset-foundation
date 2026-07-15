# Project State

## Current focus

**Phase 2 - Commerce integrity**
**Issue:** #4
**Branch:** `feat/issue-4-commerce-parity` (stacked on the hybrid-video branch until PR #3 merges)

## Current position

The discovery pass is complete. Authenticated Hotmart captures, both attached mapping documents, the PS8 research folder, the PDF, the archived workspace, Claude history, and the canonical codebase were reconciled.

Implemented in the first slice:

- Subscription is visible as a product format during creation.
- Monthly/yearly interval maps to the existing recurring checkout types.
- Paid products open the Pricing tab; free products open Curriculum.
- The order mapper now preserves authorization and financial detail fields already present in Supabase types.
- Regression tests cover the new creation flow and mapper behavior.

## Next execution order

1. Recover and version the full Supabase schema/RPC baseline.
2. Materialize recurring invoices as canonical sales/payment facts.
3. Add subscription-aware refund and creator subscriber management.
4. Introduce product/offers/prices without breaking legacy course pricing.
5. Build global creator operations, wallet, metrics, and growth engines.

## Known blockers and risks

- Local migrations create only a small subset of the database represented by generated types; production cannot yet be reproduced from the repository.
- Fourteen RPCs called by application code have no versioned definition in the repository.
- Subscription renewals update enrollment/subscription/payout state but do not create the same order/payment facts used by current sales reports.
- Existing coupon, affiliate, co-producer, and tax surfaces are not integrated into checkout/webhook/payout calculations.
- Some source screenshots contain personal or SSO data; they were reviewed locally but are intentionally not committed.

## Verification baseline

- Before changes: 31 files, 168 tests passed.
- New focused tests: monthly subscription, yearly subscription, free routing, product-format mapping, and complete order mapping.
- Current result: 33 files, 173 tests passed; TypeScript, ESLint, and production build passed.
- Visual QA passed at 1440x1100 and 390x844; evidence is stored under Phase 2.

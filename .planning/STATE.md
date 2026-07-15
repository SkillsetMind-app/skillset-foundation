# Project State

## Current focus

**Phase 2 - Commerce integrity**
**Branch:** `feat/issue-8-creator-subscriptions` (stacked on #4 commerce parity + #6 financial facts)
**Last closed slice:** Creator subscription center + MRR metrics (`a0b74ef`) — Grok continuity after Codex credits

## Current position

The discovery pass is complete. Authenticated Hotmart captures, both attached mapping documents, the PS8 research folder, the PDF, the archived workspace, Claude history, and the canonical codebase were reconciled.

Implemented in the first slice (#4):

- Subscription is visible as a product format during creation.
- Monthly/yearly interval maps to the existing recurring checkout types.
- Paid products open the Pricing tab; free products open Curriculum.
- The order mapper now preserves authorization and financial detail fields already present in Supabase types.
- Regression tests cover the new creation flow and mapper behavior.

Implemented in the second slice (#6):

- Every paid subscription invoice materializes a canonical order and payment before payout creation.
- Webhook redelivery repairs incomplete financial writes without overwriting refund state.
- Subscription enrollments can use the refund policy and resolve the latest renewal.
- Full recurring refunds cancel billing idempotently; partial refunds retain the subscription.
- Access revocation is driven by subscription lifecycle instead of the one-time refund transition.

Implemented in the third slice (creator ops — Codex WIP, closed by Grok):

- `/teach/subscriptions` page with `CreatorSubscriptionCenter` (filters, health, renewals).
- Domain metrics: active / past_due / cancel-scheduled / churn window / MRR by currency.
- Nav + i18n links under Teacher Operations (Sales + Subscriptions).
- Data-layer helpers for teacher course subscriptions and public profiles by id.
- Evidence screenshots under `.planning/phases/02-commerce-integrity/evidence/subscription-center-*.png`.
- Handoff: `HANDOFF-GROK-CONTINUIDADE.md`.

## Next execution order

1. Recover and version the full Supabase schema/RPC baseline.
2. Backfill historical recurring invoices after authenticated Stripe/Supabase access is available.
3. ~~Add creator subscriber management and recurring-revenue metrics.~~ **DONE** (`a0b74ef`)
4. Introduce product/offers/prices without breaking legacy course pricing.
5. Build global creator operations, wallet, metrics, and growth engines.

## Known blockers and risks

- Local migrations create only a small subset of the database represented by generated types; production cannot yet be reproduced from the repository.
- Fourteen RPCs called by application code have no versioned definition in the repository.
- Already-processed historical subscription invoices need an explicit backfill because completed Stripe event claims intentionally short-circuit redelivery.
- Existing coupon, affiliate, co-producer, and tax surfaces are not integrated into checkout/webhook/payout calculations.
- Some source screenshots contain personal or SSO data; they were reviewed locally but are intentionally not committed.

## Verification baseline

- Before changes: 31 files, 168 tests passed.
- After #4/#6 slices: 35 files, 180 tests passed.
- After creator center slice (`a0b74ef`): **37 files, 185 tests passed**; `tsc --noEmit` clean.
- Visual evidence: subscription-center desktop/mobile/dark under Phase 2.

## Continuity chain

Claude (Hotmart discovery) → Codex `019f388d…` (commerce + WIP UI) → Grok 2026-07-15 (verify + commit).

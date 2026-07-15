# Project State

## Current focus

**Phase 2 - Commerce integrity**
**Branch:** `feat/issue-8-creator-subscriptions`
**Last closed:** Schema baseline tables (`5b3d717`) + creator subscription center (`a0b74ef`)

## Current position

Discovery complete. Claude Hotmart research + Codex commerce work continued by Grok.

### Shipped slices

1. **#4** Subscription product format in course creation.
2. **#6** Invoice paid materializes order/payment before payout.
3. **Creator ops** `/teach/subscriptions` + MRR metrics (`a0b74ef`).
4. **Schema baseline (partial)** (`5b3d717`):
   - 37 tables versioned as `CREATE TABLE IF NOT EXISTS` from `database.types.ts`
   - RPC inventory for 14+ unversioned functions
   - Scripts: `scripts/_schema_gap_audit.py`, `scripts/generate_schema_baseline_from_types.py`
   - Report: `supabase/SCHEMA_BASELINE_REPORT.md`
   - **Blocked for live dump:** Skillset `.env.local` has URL+anon only; no `SUPABASE_SERVICE_ROLE_KEY`. Vault official env has `LUGANO_SUPABASE_*` (other product), not Skillset service role.

## Next execution order

1. ~~Schema baseline tables from types~~ **DONE** (`5b3d717`)
1b. Live `supabase db dump` when Skillset service role is available
2. Backfill historical recurring invoices — **blocked** until `STRIPE_SECRET_KEY` + service role for Skillset
3. ~~Creator subscriber management + MRR~~ **DONE** (`a0b74ef`)
4. Introduce product/offers/prices without breaking legacy course pricing
5. Global creator operations / wallet / growth engines

## Credentials note (no secrets stored here)

| Need | Skillset `.env.local` | Vault official env |
|------|----------------------|--------------------|
| Supabase URL/anon | SET | Lugano only |
| Supabase service role | MISSING | Lugano only |
| Stripe secret | MISSING | webhook id/secret only |

## Verification

- Vitest: 185 passed (post center)
- Schema baseline: generated offline from types; not applied to remote

## Continuity

Claude → Codex `019f388d…` → Grok

## Live verification 2026-07-15 (Grok)

- Skillset Supabase live host: ijtikldtjvsbtwszokvs (old wbgcujw… DNS dead).
- Live PostgREST inventory: 42 tables — supabase/LIVE_SCHEMA_INVENTORY_2026-07-15.md.
- Commerce tables row counts: all 0 (empty project data).
- Stripe live account: 0 charges / 0 invoices / 0 subscriptions — backfill dry-run is no-op.
- Keys validated: Supabase service+anon PASS, Stripe balance PASS.

## P4 + P5 closed 2026-07-15

- **P4** Checkout dual-read pricing via 
ormalizeCoursePrice + loadCourseProductOffers stub (legacy-safe).
- **P5** Creator ops hub /teach/operations + creator-ops metrics rollup + nav.
- Tests: product-pricing, creator-ops, stripe-helpers dual-read — green. 	sc --noEmit clean.
- Audit: AUDITORIA-CLAUDE-CODEX-GROK.md


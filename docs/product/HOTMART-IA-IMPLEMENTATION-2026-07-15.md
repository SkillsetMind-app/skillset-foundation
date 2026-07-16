# Hotmart IA implementation progress — 2026-07-15

Based on:
- `docs/research/hotmart-2026-07/MAPEAMENTO-HOTMART-AO-VIVO-2026-07-14.md`
- `docs/research/hotmart-2026-07/DESIGN-CLONE-SPEC-HOTMART-2026-07-14.md`
- `docs/product/HOTMART_PARITY_AUDIT_2026-07-15.md`

## Rule applied

| Clone | Keep Skillset |
|-------|----------------|
| Macro IA: rail groups, home blocks, product hub tab order | Colors, micro buttons, icons (Lucide), copy |

## Done this session

1. **Producer rail taxonomy** (`src/data/site.ts` + `platform-nav.tsx`)  
   Groups: Products · Sales · Finance · Reports · Partnerships · Setup  
   + Members area (`/teach/storefront`), Verification in nav  

2. **Studio home Hotmart structure** (`teacher-studio-dashboard.tsx`)  
   - Launch checklist + progress %  
   - My products grid + filters (All / Drafts / Live / In review / Other)  
   - “What do you want to sell?” format cards  

3. **Product hub tab order** (`course-manage-hub.tsx`)  
   Aligns with Hotmart manage menu order; deep-link `?section=`  

4. **Offers API** message points at correct migration (tables already live)  

## Explicitly deferred

| Item | Why |
|------|-----|
| PIX / boleto | BR-only; Stripe account + method setup; high ops pain for US-first launch |
| Hotmart-style installment fee pass-through | Doctrine + Stripe config; UI flags exist; full money-path later |
| Full Club multi-product members | Architecture brief prefers separate surfaces; P2 |
| Email marketing / page builder / eNotas | P2 / BR |
| Pixel-perfect Cosmos tokens | Skin stays Skillset; only macro IA |

## Issue #10 refinement completed

1. **Creator shell regressions**
   - Fixed the duplicated `SkillsetMind` lockup and active navigation rows shrinking in the sidebar.
   - Kept the Advisor as the only global floating action.
   - Replaced the generic floating help action with field-level help icons that open an accessible right-side drawer with backdrop, outside-click close, Escape close, and focus restoration.

2. **Short product creation flow**
   - Exposes course, monthly/yearly subscription, and free formats before draft creation.
   - Requires at least one of the eight practitioner-marketplace categories.
   - Keeps categories collapsed in a scrollable multi-select instead of rendering the full list in the page flow.

3. **Builder and product operations**
   - Builder order is Details → Pricing → Curriculum → Members Area → Publish.
   - Manage links deep-link to the same builder tabs; publication lives in one place.
   - Added `/teach/members` as the producer-level members-area hub.
   - Approved professionals publish directly after deterministic product checks; professional credentialing is the gate, not manual review of every course.

4. **Commerce integrity**
   - Checkout resolves a concrete offer and persists its immutable terms.
   - Offer synchronization, coupon reservation, payout release, refund transitions, and recurring financial facts use database-backed locking/idempotency paths.
   - Paid publication requires a payout-ready Stripe Connect account.

5. **Verification evidence**
   - 245 Vitest assertions pass across 47 test files.
   - Full ESLint, TypeScript, and Next.js production build pass.
   - Desktop and mobile captures cover the shell, help drawer, short creation flow, and collapsed category picker under `.planning/phases/02-commerce-integrity/evidence/`.

## Still needed after this release

- Replay live Stripe test fixtures and reconcile historical production financial events.
- Backfill historical invoices whose webhook event is already marked done.
- Complete multi-offer sales-page editing, dunning/recovery automation, and deeper members-area discovery/resume flows.
- Add country-gated payment methods only when launch-market operations and provider configuration support them.

## PIX note

Not forbidden forever. When Brazil is a launch market: enable Stripe Payment Methods (PIX) on Checkout with country/currency gates. Not started in this slice.

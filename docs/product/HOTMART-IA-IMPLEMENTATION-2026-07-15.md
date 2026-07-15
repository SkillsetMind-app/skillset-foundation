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

## Still needed for “launch ready” producer UX

- Merge/deploy branch so Vercel production gets this IA  
- Populate offers via manage → Pricing & offers  
- Manual QA of checklist → manage deep links  
- Optional: installments Stripe PaymentIntent options when multi-country card installments are enabled on the account  

## PIX note

Not forbidden forever. When Brazil is a launch market: enable Stripe Payment Methods (PIX) on Checkout with country/currency gates. Not started in this slice.

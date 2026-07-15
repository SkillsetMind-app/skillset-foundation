# Phase 2 Context: Commerce Integrity

## Decisions

- Subscription is a product format. Monthly/yearly is a billing interval.
- Learner-to-creator subscription is separate from the creator's SkillsetMind SaaS plan.
- The initial creation flow stays short: format and basics, then pricing/content in the builder.
- Existing recurring Stripe Checkout is retained; work targets creator operations and financial integrity.
- Every initial charge, renewal, refund, reversal, and payout must have a canonical, idempotent financial fact.
- Advanced commercial flexibility belongs to a future Offer entity, not more columns on the creation screen.

## Evidence

- `docs/product/HOTMART_PARITY_AUDIT_2026-07-15.md`
- `docs/research/hotmart-2026-07/`
- `src/app/api/payments/checkout/route.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/lib/data/orders.ts`
- `src/components/teacher/create-course-start.tsx`

## First slice

Deliver COM-01..COM-03 with tests, then publish a stacked preview PR. COM-04 and SUB-01..SUB-04 remain separate money-path plans so they can receive migration, idempotency, webhook, and reconciliation review.

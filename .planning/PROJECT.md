# SkillsetMind - Practitioner Learning Marketplace

## What this is

SkillsetMind is a marketplace and business operating system for psychologists, therapists, and personal-development or mental-performance professionals. Practitioners publish educational products; learners buy from independent experts. The platform is US-first with international support.

## Core value

The practitioner owns the audience, data, and commercial relationship. Product and financial behavior must preserve the Skillset Promise: predictable fees, feature parity, one-click export and cancellation, fund protection, and human support when automation cannot resolve an exception.

## Current milestone

The milestone moves from a functional course marketplace to launch-grade creator commerce:

1. Hybrid video (complete).
2. Commerce integrity and recurring operations.
3. Product/offer architecture.
4. Creator sales, subscription, receivables, and report operations.
5. Growth engines.
6. Relaunch experience, member refinements, and grounded AI.

## Source documents

- `docs/product/HOTMART_PARITY_AUDIT_2026-07-15.md` - current canonical synthesis.
- `docs/research/hotmart-2026-07/` - supplied research and historical decisions.
- `C:/Users/nicae/Downloads/skillset-design-v2-8-workspace/` - local authenticated capture archive and previous implementation studies.
- `C:/Users/nicae/Downloads/Skillset USA - A premium learning marketplace.pdf` - learner marketplace/faculty reference.

## Current architecture

- Next.js App Router on Vercel.
- Supabase Auth/Postgres/RLS.
- Stripe Connect Express and Stripe Checkout.
- Bunny Stream with Supabase Storage fallback.
- n8n/LLM integrations for automation and advisory features.

## Constraints

- Solo founder: prefer automation over recurring manual operations.
- Every financial mutation needs idempotency, an audit trail, and reconciliation evidence.
- Do not expose creator features that are only decorative configuration.
- Git workflow is Issue -> Branch -> PR; direct commits to `main` are prohibited.
- Founder gates remain external: paid infrastructure, secret rotation, anti-abuse, admin MFA, and final brand assets.

## Decisions

| Date | Decision |
|---|---|
| 2026-07-14 | Hybrid video supports YouTube and native upload in every plan. |
| 2026-07-14 | 1:1 coaching remains post-launch and separate from regulated therapy. |
| 2026-07-15 | Existing recurring checkout is retained; renewal integrity and creator operations are the real gap. |
| 2026-07-15 | Subscription is a product format; monthly/yearly is its billing interval. |
| 2026-07-15 | Learner subscriptions and creator SaaS plans remain separate domains. |
| 2026-07-15 | Product/offer separation follows financial integrity, not the other way around. |

# SkillsetMind - Practitioner Learning Marketplace

## What this is

SkillsetMind is a marketplace and business operating system for coaches, facilitators, mentors, and other personal-development and mental-performance professionals. Creators publish and sell courses; learners buy from independent experts. The platform is US-first with international support.

Vocabulary is a product constraint, not a style preference. "Therapist", "psychologist", "therapy", and "counseling" name US-regulated activity and never describe a seller or what they sell; "educational" is out by founder decision. Psychology survives only as a subject ("Applied Psychology & Behavior"). The rule is enforced in `src/domain/teacher-course.ts` and in the assistant's grounding (`src/lib/assistant/knowledge.ts`); the legal pages keep the words on purpose, to disclaim them.

## Core value

The creator owns the audience, data, and commercial relationship. Product and financial behavior must preserve the Skillset Promise as it is published on `/promise`: predictable fees, feature parity, one-click export and cancellation, **money that never passes through SkillsetMind**, and human support when automation cannot resolve an exception.

That fifth item used to read "fund protection", which assumed the platform held the funds. Under Stripe Connect direct charges the buyer pays the creator's connected account and we never take possession, so the promise is stronger and simpler: we cannot lose or freeze what we never touch.

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

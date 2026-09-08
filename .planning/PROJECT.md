# SkillsetMind - Practitioner Learning Marketplace

## What this is

SkillsetMind is a marketplace and business operating system for coaches, facilitators, mentors, and other personal-development and mental-performance professionals. Creators publish and sell courses; learners buy from independent experts. The platform is US-first with international support.

Vocabulary is a product constraint, not a style preference. "Therapist", "psychologist", "therapy", and "counseling" name US-regulated activity and never describe a seller or what they sell; "educational" is out by founder decision. Psychology survives only as a subject ("Applied Psychology & Behavior"). The rule is enforced in `src/domain/teacher-course.ts` and in the assistant's grounding (`src/lib/assistant/knowledge.ts`); the legal pages keep the words on purpose, to disclaim them.

## Core value

The creator owns the audience, data, and commercial relationship. Product and financial behavior must preserve the Skillset Promise as it is published on `/promise`: predictable fees, feature parity, one-click export and cancellation, **money that never passes through SkillsetMind**, and human support when automation cannot resolve an exception.

That fifth item used to read "fund protection", which assumed the platform held the funds. Under Stripe Connect direct charges the buyer pays the creator's connected account and we never take possession, so the promise is stronger and simpler: we cannot lose or freeze what we never touch.

## Current Milestone: v1.1 Hotmart parity v2 (started 2026-09-07)

**Goal:** Every option of the Hotmart producer menu, course center, members-area (Club) menu, learner screens and commercial flows is compared with SkillsetMind screen by screen (desktop 1440 and mobile 390, full page, destination of every button), and the gaps worth closing become one PR per flow, starting with archive/delete course.

**Why now:** the founder asked for (a) a clear place to delete a course for the admin and for the teacher, "if it exists on Hotmart it has to exist here", and (b) flow-by-flow parity of layout, hierarchy and spacing on desktop and mobile. Previous comparisons (July and 2026-09-06) were narrative; nobody could say which screens had actually been seen.

**Method:** coverage is a count, not a feeling. A closed checklist (91 rows) is filled line by line; an empty column at the end means the screen was missed. Hotmart is read-only at all times (no purchase, post, upload, campaign, setting change).

**Target features (phases 7-12):**
- F0 closed checklist (done 2026-09-07, private vault).
- F1 Hotmart extraction and F2 SkillsetMind extraction with the same numbering and file naming.
- F3 comparison matrix: equal / adopt / adapt / skip per row, with measurements, ordered by value.
- F4 parity PRs per flow, first one archive/delete course (`delete_teacher_course_draft` and `delete_course_as_admin` already exist as RPCs).
- F5 final logged-in QA by the founder.

**Roles (founder rule, 2026-09-07):** extraction (F1, F2) runs on a cheap model that follows the checklist; direction, design and what to adopt (F3) plus every PR review are done by the session owner model; PR code (F4) goes to a builder model. Whoever reviews sits one step above whoever built.

## Milestone history

**v1.0 launch program (2026-07-14 to 2026-07-15, paused at Phase 2):** hybrid video shipped (Phase 1); commerce integrity started (COM-01..03, SUB-01..02 shipped). Phases 2-6 remain in the roadmap and resume after v1.1. Between July and September the product moved on outside this planning folder (waves 6-10, PRs #107-#241): creator home, product management hub, builder, members area, learner classroom, auth flows, ES locale, app/consumer/pay hosts.

## Source documents

- Private vault (PS8-OS), folder `03-projetos/skillsetmind/`: `PLANO-PARIDADE-HOTMART-v2-2026-09-07.md` (this milestone's plan), `paridade-v2/CHECKLIST-F0-2026-09-07.md` (the 91-row checklist), `MAPEAMENTO-HOTMART-AO-VIVO-2026-07-14.md` (producer menu, 7 groups; course center, 11 tabs), `PARIDADE-DESIGN-HOTMART-2026-09-06.md` (tokens side by side, creator shell, learner, commercial, priorities P0-P7).
- Local capture archives (never committed): `skillset-codex-hotmart-evidence/` (34 Hotmart captures, 2026-09-06) and `skillset-paridade-v2-evidence/` (F1/F2 captures).
- `docs/product/HOTMART_PARITY_AUDIT_2026-07-15.md` - July synthesis.
- `docs/research/hotmart-2026-07/` - supplied research and historical decisions.

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
- Git workflow is Issue -> Branch -> PR; direct commits to `main` are prohibited (branch protection: PR + required checks since 2026-09-07).
- House PR pattern: title "fix/feat: what the person suffered" (PT-BR); body "sofria / muda / fora / prova"; proof by reversal; tsc and eslint; draft promoted so the Porteiro reviewer runs; squash merge; visual QA at 390/768/1440.
- Founder gates remain external: paid infrastructure, secret rotation, anti-abuse, admin MFA, and final brand assets.
- This repository is public: no account e-mails, screenshots or session data in `.planning/`.

## Decisions

| Date | Decision |
|---|---|
| 2026-07-14 | Hybrid video supports YouTube and native upload in every plan. |
| 2026-07-14 | 1:1 coaching remains post-launch and separate from regulated therapy. |
| 2026-07-15 | Existing recurring checkout is retained; renewal integrity and creator operations are the real gap. |
| 2026-07-15 | Subscription is a product format; monthly/yearly is its billing interval. |
| 2026-07-15 | Learner subscriptions and creator SaaS plans remain separate domains. |
| 2026-07-15 | Product/offer separation follows financial integrity, not the other way around. |
| 2026-09-03 | Ops in the sidebar; members area dark; collect data now; optimistic publishing without a review queue (founder). |
| 2026-09-07 | Parity coverage is a count: closed checklist, empty column = missed screen. |
| 2026-09-07 | Extraction runs one platform at a time in the connected Chrome window: capturing a background tab freezes the renderer, so two parallel agents in one window are not viable. |
| 2026-09-07 | Captures stay outside the repo and outside the vault git (account data); only per-item notes and the checklist are versioned, in the private vault. |
| 2026-09-07 | Whether a teacher may archive a published course (as Hotmart deactivates instead of deleting) is decided after F1 evidence, not before. |
| 2026-09-08 | Pages that only SkillsetMind has (Online events first) are not compared with Hotmart; they receive the house pattern distilled from the pages where parity was reached. |
| 2026-09-08 | Requested by the founder, pending design and go: login served on `sso.skillsetmind.com`, buyers landing on `consumer.`, creators on `app.` (served, not redirected), and Google sign-in switched on. Both touch the session cookie domain and DNS; they run as their own phase, not inside the parity PRs. |

---
*Last updated: 2026-09-07 after opening milestone v1.1 (issue #243)*

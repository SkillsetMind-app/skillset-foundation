# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-07)

**Core value:** The creator owns the audience, data, and commercial relationship; money never passes through SkillsetMind.
**Current focus:** Milestone v1.1 Hotmart parity v2 (phases 7-12), issue #243.

## Current Position

Phase: 11 of 12 (parity PRs, F4) running in parallel with the tail of Phases 8/9 (extraction rounds F1-r3 and F2-r5, Sonnet agents) and Phase 10 (design verdicts in the private vault, `F3-DECISOES.md`).
Plan: 11-01 done (PR #253 merged `e224584`, migration applied in production first); next 11-02 (publish checklist panel, B01), 11-03 (pricing summary + Free/subscription bug, B04), then B02 storefront card.
Status: In progress
Last activity: 2026-09-08 03:40 — PR #253 reviewed by Fable, migration `20260908120000` applied and verified in production via Management API, squash-merged; issue #249 closed. Four front micro-PRs also merged tonight (#246 sidebar scrollbar, #248 compact locale button, #251 brand mark PNGs, #254 collapsed-rail centering).

Progress (v1.1): [███░░░░░░░] 1 of 6 phases complete (7 done; 8, 9, 10, 11 in progress)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md. Recent decisions affecting current work:

- Phase 7: coverage is a count; empty column = missed screen.
- Phase 8/9: one platform at a time in the connected Chrome window (background-tab capture freezes the renderer); captures stay outside the repo; per-row notes in the private vault.
- Phase 11: teacher archive of a published course is decided after Phase 8 row C04, not before.

### Facts verified in code (2026-09-08)

- Teacher delete/archive: `deleteOrArchiveCourse` -> RPC `delete_or_archive_own_course` (deletes when 0 enrollments and 0 orders, otherwise archives as `inactive`), `src/lib/data/teacher-courses.ts`; entry points are the hub caret menu and the product list row menu (`src/components/teacher/course-actions.tsx`). `delete_teacher_course_draft` stays in the database for compatibility only.
- Admin delete: `deleteCourseAsAdmin` -> RPC `delete_course_as_admin`, two-step confirmation, `src/components/admin/managed-course-panel.tsx` (unchanged).
- RLS `courses_delete_owner` now requires no enrollment and no order for the course (applied in production 2026-09-08).
- Learner access depends on the enrollment (active/completed), not on the course status, so archiving never removes a buyer's access.

### Pending Todos

- Phase 11: 11-02 (B01 checklist panel: checklist to the top for unpublished courses, "Edit" link per row, done rows in soft green, no duplication in "Needs your attention"), 11-03 (B04 pricing: summary cards, refund window, offers table first; bug "PRICE Free" + "Monthly subscription" + form born at 97 USD), B02 storefront card.
- Phase 10: verdicts still open for sections A, E, F, mobile, and the house pattern for pages only SkillsetMind has (online events).
- Founder-dependent, outside this milestone's PRs: `sso.` DNS not resolving at last check; go/no-go for the sso/consumer/app login phase (cookie domain change logs everyone out); Google OAuth client + consent screen before enabling the provider; visual QA in production of the four front micro-PRs.

### Blockers/Concerns

- Hotmart session is only available in a Chrome profile without the Claude extension; the gstack cookie import cannot be used while Chrome is open (App-Bound Encryption needs Chrome closed).
- Production catalog is empty (no published course), so public course page and checkout on SkillsetMind will be marked `vazio em produção` unless demo data is provided.
- v1.0 blockers carried over (unchanged since 2026-07-15): live schema dump and recurring-invoice backfill wait for a Skillset service-role key and Stripe secret in the local env; nothing is stored in this file.

## Session Continuity

Last session: 2026-09-08 03:40
Stopped at: F1 round 3 and F2 round 5 extraction agents running in the connected Chrome (CDP, `pw.mjs`); 11-01 shipped; 11-02 brief being prepared for an Opus agent once an agent slot frees (two-agent ceiling for RAM).
Resume file: None

## v1.0 context (2026-07-15, paused)

- Shipped: #4 subscription product format; #6 invoice paid materializes order/payment before payout; creator ops `/teach/subscriptions` + MRR metrics (`a0b74ef`); partial schema baseline (`5b3d717`): 37 tables versioned from `database.types.ts`, RPC inventory for 14+ unversioned functions, scripts `scripts/_schema_gap_audit.py` and `scripts/generate_schema_baseline_from_types.py`, report `supabase/SCHEMA_BASELINE_REPORT.md`.
- Live verification (Grok): PostgREST inventory of 42 tables in `supabase/LIVE_SCHEMA_INVENTORY_2026-07-15.md`; commerce tables empty; Stripe live account with 0 charges/invoices/subscriptions; keys validated.
- P4 checkout dual-read pricing (`normalizeCoursePrice` + `loadCourseProductOffers` stub) and P5 creator ops hub `/teach/operations` closed; tests green; `tsc --noEmit` clean; audit in `AUDITORIA-CLAUDE-CODEX-GROK.md`.
- Continuity chain: Claude -> Codex -> Grok.

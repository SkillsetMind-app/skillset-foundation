# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-07)

**Core value:** The creator owns the audience, data, and commercial relationship; money never passes through SkillsetMind.
**Current focus:** Milestone v1.1 Hotmart parity v2 (phases 7-12), issue #243.

## Current Position

Phase: 11 of 12 (parity PRs, F4). Phases 8 and 9 (extraction) closed their last rounds: Hotmart 90/95 desktop, 82 mobile, 72 full-page (171 prints); SkillsetMind 100/100/100 (265 prints). Phase 10 (design verdicts, `F3-DECISOES.md` in the private vault) covers sections A, B, C, D, F and the visible part of E; rows E04–E11/E13 and F01/F02 stay blocked until production has one enrollment or a seeded preview exists.
Plan: done — 11-01 (#253, migration applied in production first), 11-02 (#258 checklist panel), 11-03 (#262 pricing shape + offer form seeded + 4 tiles + list before form), 11-04 (#269 home thumbnails + revenue block only with sales), 11-05 (#261 marketing cards + live storefront page), 11-06 (#271 earnings: one sentence, 4-column tiles, Stripe locale, teacher shell), 11-07 (#278 reports: period, 4 KPIs, shared revenue chart, by-product table, CSV), 11-08 (#265 sales frame + refund link), 11-10 (#272 login by role + switch link + Google button behind the flag), 11-11 (#274 Teach shortcut in the Learn sidebar), 11-12 (#266 builder curriculum list-first), B02 (#277 storefront card in promo links), plus the guard fix #257. In progress: 11-13 (online events on the 7-item house pattern). Left: 11-14 (i18n debt in the offers and wallet panels).
Status: In progress — Phase 11 nearly complete; Phase 12 (F5 visual QA in production at 390/768/1440 with the connected Chrome) is next.
Last activity: 2026-09-08 06:17 — seventeen PRs merged tonight; every merge reviewed by Fable; worktrees cleaned with the junction detached first.

Progress (v1.1): [█████░░░░░] 3 of 6 phases complete (7, 8, 9 done; 10 done except blocked rows; 11 in progress)

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

Last session: 2026-09-08 06:18
Stopped at: 11-13 running (Opus, worktree `skillset-11-13`); 11-14 brief ready in the session scratchpad; handoff in the daily log `PS8-OS/06-daily/2026-09-07-skillsetmind-paridade-hotmart-v2.md`. Next phase: F5 visual QA in production (the connected Chrome on port 9333 stays open with both logins), then promote and merge this docs PR (#244).
Resume file: None

## v1.0 context (2026-07-15, paused)

- Shipped: #4 subscription product format; #6 invoice paid materializes order/payment before payout; creator ops `/teach/subscriptions` + MRR metrics (`a0b74ef`); partial schema baseline (`5b3d717`): 37 tables versioned from `database.types.ts`, RPC inventory for 14+ unversioned functions, scripts `scripts/_schema_gap_audit.py` and `scripts/generate_schema_baseline_from_types.py`, report `supabase/SCHEMA_BASELINE_REPORT.md`.
- Live verification (Grok): PostgREST inventory of 42 tables in `supabase/LIVE_SCHEMA_INVENTORY_2026-07-15.md`; commerce tables empty; Stripe live account with 0 charges/invoices/subscriptions; keys validated.
- P4 checkout dual-read pricing (`normalizeCoursePrice` + `loadCourseProductOffers` stub) and P5 creator ops hub `/teach/operations` closed; tests green; `tsc --noEmit` clean; audit in `AUDITORIA-CLAUDE-CODEX-GROK.md`.
- Continuity chain: Claude -> Codex -> Grok.

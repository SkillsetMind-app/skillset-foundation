# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-07)

**Core value:** The creator owns the audience, data, and commercial relationship; money never passes through SkillsetMind.
**Current focus:** Milestone v1.1 Hotmart parity v2 (phases 7-12), issue #243.

## Current Position

Phase: 9 of 12 (SkillsetMind extraction, F2) — Phase 8 (Hotmart extraction, F1) waits for the founder's Hotmart login in the connected browser and runs right after, in the same window.
Plan: 1 of 1 in the current phase (extraction agent run)
Status: In progress
Last activity: 2026-09-07 — Phase 7 complete (91-row checklist); milestone opened on branch `docs/issue-243-paridade-hotmart-v2`; F2 extraction agent started.

Progress (v1.1): [██░░░░░░░░] 1 of 6 phases complete

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md. Recent decisions affecting current work:

- Phase 7: coverage is a count; empty column = missed screen.
- Phase 8/9: one platform at a time in the connected Chrome window (background-tab capture freezes the renderer); captures stay outside the repo; per-row notes in the private vault.
- Phase 11: teacher archive of a published course is decided after Phase 8 row C04, not before.

### Facts verified in code (2026-09-07)

- Teacher delete: `deleteTeacherCourse` -> RPC `delete_teacher_course_draft` (draft only), `src/components/teacher/teacher-course-studio.tsx`.
- Admin delete: `deleteCourseAsAdmin` -> RPC `delete_course_as_admin`, two-step confirmation, `src/components/admin/managed-course-panel.tsx`.
- Both RPCs are declared in `src/lib/data/teacher-courses.ts`.

### Pending Todos

- Founder: log into Hotmart in the tab the session opened in the connected Chrome window (or install the Claude extension in the Hotmart profile), so Phase 8 can start.
- After Phases 8 and 9: Phase 10 matrix, then Phase 11 plan 11-01 (archive/delete course).

### Blockers/Concerns

- Hotmart session is only available in a Chrome profile without the Claude extension; the gstack cookie import cannot be used while Chrome is open (App-Bound Encryption needs Chrome closed).
- Production catalog is empty (no published course), so public course page and checkout on SkillsetMind will be marked `vazio em produção` unless demo data is provided.
- v1.0 blockers carried over (unchanged since 2026-07-15): live schema dump and recurring-invoice backfill wait for a Skillset service-role key and Stripe secret in the local env; nothing is stored in this file.

## Session Continuity

Last session: 2026-09-07 23:30
Stopped at: F2 extraction agent running in the connected browser; GSD milestone docs written on the docs branch, PR pending.
Resume file: None

## v1.0 context (2026-07-15, paused)

- Shipped: #4 subscription product format; #6 invoice paid materializes order/payment before payout; creator ops `/teach/subscriptions` + MRR metrics (`a0b74ef`); partial schema baseline (`5b3d717`): 37 tables versioned from `database.types.ts`, RPC inventory for 14+ unversioned functions, scripts `scripts/_schema_gap_audit.py` and `scripts/generate_schema_baseline_from_types.py`, report `supabase/SCHEMA_BASELINE_REPORT.md`.
- Live verification (Grok): PostgREST inventory of 42 tables in `supabase/LIVE_SCHEMA_INVENTORY_2026-07-15.md`; commerce tables empty; Stripe live account with 0 charges/invoices/subscriptions; keys validated.
- P4 checkout dual-read pricing (`normalizeCoursePrice` + `loadCourseProductOffers` stub) and P5 creator ops hub `/teach/operations` closed; tests green; `tsc --noEmit` clean; audit in `AUDITORIA-CLAUDE-CODEX-GROK.md`.
- Continuity chain: Claude -> Codex -> Grok.

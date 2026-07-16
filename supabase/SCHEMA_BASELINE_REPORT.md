# Schema Baseline Report

**Generated:** 2026-07-15
**Updated:** 2026-07-15
**Type source:** `src/lib/supabase/database.types.ts`
**Live project:** `ijtikldtjvsbtwszokvs`

## Sources used

- Canonical read-only artifacts:
  `LIVE_SCHEMA_INVENTORY_2026-07-15.md` and
  `live_schema_inventory_2026-07-15.json`.
- Live PostgREST OpenAPI fetched read-only with the local Skillset service role;
  used only to confirm exposed RPC names and argument signatures.
- Live `pg_get_functiondef` results captured on 2026-07-07 and 2026-07-15.
- Exact SQL migrations previously applied to the live project for functions not
  present in those `pg_get_functiondef` result sets.

No command in this work changed the live database. No secret was printed or
written to the repository.

## Table baseline

The type-derived table baseline intends to add 37 tables that were absent from
the older migration history:

- `20260715_schema_baseline_tables_from_types.sql`

This file remains a structural approximation. The reserved
`leaderboards.window` column is quoted so the migration parses, but types such
as timestamps, arrays, constraints, indexes, foreign keys, triggers, RLS
policies, grants, and defaults must ultimately be replaced by a real schema-only
database dump.

## RPC baseline added

The application had 12 directly called RPCs with no local function body. They
are now versioned in two idempotent migrations:

- `20260716000100_live_teacher_course_rpcs.sql`
- `20260716000200_live_application_rpcs.sql`

Directly called RPCs added:

- `create_free_course_enrollment`
- `create_teacher_course_draft`
- `delete_course_as_admin`
- `delete_teacher_course_draft`
- `is_admin`
- `issue_skillset_certificate`
- `record_lesson_progress`
- `request_account_action`
- `send_course_message`
- `submit_course_review`
- `update_teacher_course_builder`
- `verify_skillset_certificate`

Required helpers added with the same baseline:

- `course_title_key`
- `log_audit_event`
- `platform_fee_bps_for_plan`

`enforce_rate_limit` and `claim_checkout_lock` remain owned by
`20260715_hotmart_parity_money_path.sql`. The application RPC baseline removes
the obsolete `enforce_rate_limit(text, integer, bigint)` overload after the
versioned integer signature exists, preventing named-argument ambiguity in
PostgREST.

## Coverage check

The current worktree contains 27 literal `.rpc(...)` names. A source-to-migration
scan found a `CREATE FUNCTION` or `CREATE OR REPLACE FUNCTION` body for all 27.
Five checkout/offer RPCs and their untracked migration were added concurrently
by another worker and were not modified here.

The live OpenAPI signatures for all 12 RPCs listed above match the signatures in
the new migrations. In particular:

- `create_teacher_course_draft(text, text, text, text[], text) returns text`
- `update_teacher_course_builder(text, jsonb) returns jsonb`

The 2026-07-15 live `pg_get_functiondef` for
`update_teacher_course_builder` includes blind `modules` JSONB pass-through,
lesson-content mirroring, and `community_enabled`; all are preserved.

## Validation performed

- PostgreSQL 18 with `check_function_bodies = on` and
  `plpgsql.extra_warnings = 'all'`.
- Both RPC migrations applied successfully to a disposable local database.
- Both RPC migrations reapplied successfully, checking idempotence.
- Local smoke flow executed all 15 versioned functions/helpers involved in the
  RPC baseline, including create/update/delete teacher course, free enrollment,
  progress, certificate issue/verify, account action, message, and review.
- `20260704_add_bunny_video_id.sql` applied successfully with `course_assets`
  absent, then present, then reapplied; exactly one `bunny_video_id text` column
  remained.
- Static coverage check: 27 application RPC names, zero missing function bodies.

All disposable databases and test roles were removed after validation.

## Remaining live-only schema surface

The following typed/RLS helper functions still have no local body and are not
directly invoked through `.rpc(...)` by the application:

- `has_enrollment_for_course_slug`
- `is_moderator`
- `is_ops`
- `is_service_role`
- `is_support`
- `is_target_author`
- `is_teacher`

A complete schema-only dump is still required to reproduce these helpers,
triggers, policies, grants, and production-accurate table definitions. The local
vault exposes only Lugano Supabase variables; the Skillset `.env.local` service
role can read PostgREST metadata but cannot execute `pg_get_functiondef` or
`supabase db dump` without database/management credentials.

The RPC layer covered by this report is reproducible once its table prerequisites
exist. A full clean `supabase db reset` still requires reconciling older
pre-baseline policy migrations and replacing the type-derived table
approximation with a real dump.

# Schema Baseline Report

**Generated:** 2026-07-15  
**Source of truth (types):** `src/lib/supabase/database.types.ts`  
**Migrations before:** 5 tables, 10 functions  
**Types:** 42 tables, 22 functions  

## Gap

| Kind | In types | In migrations | Missing from migrations |
|------|----------|---------------|-------------------------|
| Tables | 42 | 5 | 37 |
| Functions | 22 | 10 | 14 |

## Artifacts

- `20260715_schema_baseline_tables_from_types.sql` — `CREATE TABLE IF NOT EXISTS` for 37 missing tables
- `20260715_schema_baseline_rpc_inventory.sql` — inventory of RPCs still needing real SQL bodies

## Missing tables

- `account_action_requests`
- `audit_log`
- `certificates`
- `checkout_locks`
- `community_comments`
- `community_post_likes`
- `community_posts`
- `community_reports`
- `course_assets`
- `course_event_rsvps`
- `course_events`
- `course_lesson_content`
- `course_messages`
- `course_reviews`
- `course_subscriptions`
- `course_title_keys`
- `courses`
- `enrollments`
- `leaderboards`
- `learning_path_items`
- `learning_paths`
- `lesson_comments`
- `lesson_progress`
- `member_stats`
- `notifications`
- `orders`
- `payments`
- `payout_ledger`
- `platform_config`
- `points_events`
- `processed_stripe_events`
- `public_profiles`
- `rate_limits`
- `subscriptions`
- `support_tickets`
- `users`
- `wishlists`

## Missing / unversioned functions (types)

- `claim_checkout_lock`
- `create_free_course_enrollment`
- `create_teacher_course_draft`
- `delete_teacher_course_draft`
- `enforce_rate_limit`
- `has_enrollment_for_course_slug`
- `is_target_author`
- `issue_skillset_certificate`
- `log_audit_event`
- `record_lesson_progress`
- `send_course_message`
- `submit_course_review`
- `update_teacher_course_builder`
- `verify_skillset_certificate`

## App RPC calls needing versioning

- `claim_checkout_lock`
- `create_free_course_enrollment`
- `create_teacher_course_draft`
- `delete_course_as_admin`
- `delete_teacher_course_draft`
- `enforce_rate_limit`
- `is_admin`
- `issue_skillset_certificate`
- `record_lesson_progress`
- `request_account_action`
- `send_course_message`
- `submit_course_review`
- `update_teacher_course_builder`
- `verify_skillset_certificate`

## How to replace with live dump (when service role available)

```bash
# Load Skillset env (NOT Lugano keys from the vault file)
# Required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in project .env.local
npx supabase db dump --schema public -f supabase/migrations/20260715_live_schema_dump.sql
```

**Note:** Vault `Todas as APIs Oficial.env` currently exposes **Lugano** Supabase keys (`LUGANO_SUPABASE_*`), not Skillset. Use Skillset project keys only.

## Safety

- Baseline uses `IF NOT EXISTS` only.
- Column types are TS approximations (text/numeric/boolean/jsonb).
- No RLS policies generated here — add after live dump.
- No secrets in this report.

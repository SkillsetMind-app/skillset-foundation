# Live Schema Inventory — 2026-07-15

**Host:** `ijtikldtjvsbtwszokvs.supabase.co`  
**Tables exposed via PostgREST:** 42  

## Commerce row counts

| Table | Rows |
|-------|------|
| `courses` | 0 |
| `orders` | 0 |
| `payments` | 0 |
| `course_subscriptions` | 0 |
| `payout_ledger` | 0 |
| `processed_stripe_events` | err:HTTPError |
| `enrollments` | 0 |
| `users` | err:HTTPError |
| `subscriptions` | 0 |

## All tables

- `account_action_requests` (9 cols)
- `audit_log` (9 cols)
- `certificates` (17 cols)
- `checkout_locks` (9 cols)
- `community_comments` (10 cols)
- `community_post_likes` (3 cols)
- `community_posts` (10 cols)
- `community_reports` (15 cols)
- `course_assets` (15 cols)
- `course_commerce_settings` (10 cols)
- `course_coproducers` (8 cols)
- `course_coupons` (11 cols)
- `course_event_rsvps` (9 cols)
- `course_events` (14 cols)
- `course_lesson_content` (6 cols)
- `course_messages` (9 cols)
- `course_reviews` (8 cols)
- `course_subscriptions` (15 cols)
- `course_title_keys` (1 cols)
- `courses` (41 cols)
- `creator_verification_cases` (14 cols)
- `enrollments` (14 cols)
- `leaderboards` (3 cols)
- `learning_path_items` (4 cols)
- `learning_paths` (7 cols)
- `lesson_comments` (8 cols)
- `lesson_progress` (4 cols)
- `member_stats` (6 cols)
- `notifications` (9 cols)
- `orders` (25 cols)
- `payments` (14 cols)
- `payout_ledger` (31 cols)
- `platform_config` (2 cols)
- `platform_settings` (3 cols)
- `points_events` (7 cols)
- `processed_stripe_events` (4 cols)
- `public_profiles` (7 cols)
- `rate_limits` (4 cols)
- `subscriptions` (14 cols)
- `support_tickets` (13 cols)
- `users` (36 cols)
- `wishlists` (6 cols)

## Notes

- Sourced from PostgREST OpenAPI with service role (live).
- Full SQL dump (`CREATE FUNCTION`/RLS) still needs `supabase db dump` or DB password.
- This inventory unblocks gap analysis vs `database.types.ts` and local migrations.

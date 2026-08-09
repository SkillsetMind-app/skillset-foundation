-- Covering indexes for the five foreign keys Supabase's performance advisor
-- reports as unindexed. All five are on money-path tables:
--
--   payments.order_id        -> the join every receipt, refund and webhook does
--   payments.user_id         -> "my payments" in the account area
--   orders.course_id         -> per-course sales, and the parent-side scan a
--                               course delete has to run to enforce the FK
--   subscriptions.user_id    -> the caller's own subscription lookup
--   course_subscriptions.course_slug
--
-- An unindexed FK also costs on the PARENT side: deleting or updating a
-- referenced row forces a sequential scan of the child table to validate the
-- constraint. With four tables still at 0 rows that is free today and never
-- gets cheaper to add later.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: apply_migration wraps the
-- statement in a transaction, where CONCURRENTLY is not allowed, and on empty
-- tables the exclusive lock is held for microseconds.

create index if not exists payments_order_idx
  on public.payments (order_id);

create index if not exists payments_user_idx
  on public.payments (user_id);

create index if not exists orders_course_idx
  on public.orders (course_id);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id);

create index if not exists course_subscriptions_course_slug_idx
  on public.course_subscriptions (course_slug);

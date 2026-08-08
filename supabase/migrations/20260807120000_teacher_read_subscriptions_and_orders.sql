-- Teacher could not read their own subscribers or orders.
--
-- course_subscriptions and orders each had a single SELECT policy scoped to
-- user_id (the buyer), but the creator subscription center queries them by
-- teacher_id. RLS filters silently, so the teacher saw 0 subscribers / 0 MRR
-- while payout_ledger (which already had payout_ledger_teacher_read) still
-- showed renewals. These two policies mirror that existing one.
--
-- Names: students are deliberately absent from public_profiles (that table is
-- world-readable by anon). A zero-argument SECURITY DEFINER function returns
-- name + photo for the callers's own subscribers only -- no id list means no
-- enumeration surface.

create policy course_subscriptions_teacher_read on public.course_subscriptions
  for select to authenticated
  using (teacher_id = (select auth.uid())::text);

create policy orders_teacher_read on public.orders
  for select to authenticated
  using (teacher_id = (select auth.uid())::text);

create or replace function public.get_my_subscriber_profiles()
returns table (uid text, display_name text, photo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.uid, u.display_name, u.photo_url
  from public.users u
  where u.uid in (
    select cs.user_id
    from public.course_subscriptions cs
    where cs.teacher_id = (select auth.uid())::text
    union
    select o.user_id
    from public.orders o
    where o.teacher_id = (select auth.uid())::text
  );
$$;

revoke execute on function public.get_my_subscriber_profiles() from public, anon;
grant execute on function public.get_my_subscriber_profiles() to authenticated;

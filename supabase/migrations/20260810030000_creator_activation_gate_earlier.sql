-- Moves the activation-fee gate from "publish" back to "touch a course at all".
--
-- 20260730000100 gated only publish_teacher_course. That let an unpaid creator
-- build an entire course and only hit the paywall at the last step. The product
-- decision is pay-first: the fee is the door, not the checkout line.
--
-- Implemented as ONE trigger on public.courses instead of editing the three
-- RPCs (create_teacher_course_draft, update_teacher_course_builder,
-- publish_teacher_course) plus the courses_insert_owner policy. A trigger fires
-- inside SECURITY DEFINER functions too, so it also closes the raw supabase-js
-- INSERT path that bypasses the RPCs entirely.
--
-- Admins are exempt. Without that, flipping the flag would lock out the
-- platform owner's own account, since nobody has paid the fee yet.

create or replace function public.creator_activation_blocked(p_uid text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with target as (select coalesce(p_uid, (select auth.uid())::text) as uid)
  select
    coalesce((
      select (ps.value #>> '{}')::boolean
      from public.platform_settings ps
      where ps.key = 'require_activation_fee'
    ), false)
    and (select uid from target) is not null
    and not public.is_admin()
    and not exists (
      select 1
      from public.users u
      where u.uid = (select uid from target)
        and u.activation_fee_paid_at is not null
    );
$$;

comment on function public.creator_activation_blocked(text) is
  'True when the require_activation_fee flag is on and this user has not paid. Admins and service-role contexts are never blocked.';

revoke all on function public.creator_activation_blocked(text) from public, anon;
grant execute on function public.creator_activation_blocked(text) to authenticated, service_role;

create or replace function public.enforce_creator_activation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Only gate the creator writing to their OWN course. A student-triggered
  -- counter update or a service-role webhook has a different (or null) uid and
  -- must pass through untouched.
  if new.owner_id is not null
     and new.owner_id = (select auth.uid())::text
     and public.creator_activation_blocked(new.owner_id) then
    -- Wording is load-bearing: course-builder-studio.tsx matches on
    -- "activation fee" to show the friendly copy. Keep this string in sync
    -- with the message inside publish_teacher_course.
    raise exception 'Pay the one-time activation fee before creating or publishing courses.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_creator_activation() from public, anon, authenticated;

drop trigger if exists courses_creator_activation_gate on public.courses;
create trigger courses_creator_activation_gate
  before insert or update on public.courses
  for each row
  execute function public.enforce_creator_activation();

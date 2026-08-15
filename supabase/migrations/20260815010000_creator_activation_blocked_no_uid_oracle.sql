-- creator_activation_blocked(p_uid) is SECURITY DEFINER and granted to
-- `authenticated`, and p_uid is caller-supplied. Any signed-in user could POST
-- /rest/v1/rpc/creator_activation_blocked with somebody else's uid and read back
-- a boolean answering "has this creator paid the activation fee?" -- billing
-- state on another account, which RLS on public.users otherwise hides.
--
-- `and not public.is_admin()` did NOT prevent this. It is a conjunct in the
-- boolean expression, not a guard: it only means admins are never *reported* as
-- blocked. A non-admin probing another uid got a real answer.
--
-- The grant has to stay -- two live call sites use the caller's own token:
--   src/lib/data/creator-verification.ts:113  (browser client)
--   src/lib/payments/server/auth.ts:85        (user-scoped server client)
-- Both call it with NO argument, so revoking `authenticated` would break the
-- creator gate instead of hardening it. The fix is to stop honouring p_uid for
-- signed-in callers rather than to remove their access.
--
-- Nothing else changes. The only caller that passes p_uid is the courses
-- trigger (enforce_creator_activation), and it already requires
-- `new.owner_id = auth.uid()` before calling, so the value it passes is the
-- caller's own uid by construction.
create or replace function public.creator_activation_blocked(p_uid text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with target as (
    select case
      -- No auth.uid() means service-role / trigger context with no user session;
      -- those may still name a user.
      when (select auth.uid()) is null then p_uid
      -- A signed-in caller only ever gets an answer about themselves.
      else (select auth.uid())::text
    end as uid
  )
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
  'True when the require_activation_fee flag is on and this user has not paid. Admins and service-role contexts are never blocked. p_uid is honoured only for service-role callers; a signed-in caller always gets the answer for their own uid.';

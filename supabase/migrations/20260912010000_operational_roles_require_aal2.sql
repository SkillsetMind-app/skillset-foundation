-- Operational roles authorize platform-wide reads and writes. A password-only
-- session must never activate them, even when the account has not enrolled TOTP.
-- Ordinary self-service policies remain available so the user can configure MFA.
create function public.privileged_session_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.account_session_allowed()
    and auth.uid() is not null
    and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$function$;
revoke all on function public.privileged_session_allowed() from public, anon, authenticated, service_role;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.privileged_session_allowed() and exists (
    select 1 from public.users u
    where u.uid = auth.uid()::text and u.roles ? 'admin'
  );
$function$;
create or replace function public.is_ops() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.privileged_session_allowed() and exists (
    select 1 from public.users u
    where u.uid = auth.uid()::text and (u.roles ? 'ops' or u.roles ? 'admin')
  );
$function$;

create or replace function public.is_support() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.privileged_session_allowed() and exists (
    select 1 from public.users u
    where u.uid = auth.uid()::text and (u.roles ? 'support' or u.roles ? 'admin')
  );
$function$;

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.privileged_session_allowed() and exists (
    select 1 from public.users u
    where u.uid = auth.uid()::text and (u.roles ? 'moderator' or u.roles ? 'admin')
  );
$function$;

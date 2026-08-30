-- Trigger functions never belong on the REST surface. Postgres grants EXECUTE to
-- PUBLIC by default, so the function added by 20260820000000 was reachable as
-- /rest/v1/rpc/sync_public_domain by anon and authenticated. It is SECURITY
-- DEFINER, so a direct call would run with owner privileges outside of any
-- trigger context.
--
-- Same pattern as 20260725000100 (handle_new_user, notify_enrolled_on_course_event)
-- and 20260806220000 (sync_public_profile, drop_public_profile).
-- Detected by the Supabase linter (anon_security_definer_function_executable).

revoke execute on function public.sync_public_domain() from public, anon, authenticated;

-- ponytail: a assercao E o teste - falha alto se um grant sobreviver.
do $$
declare
  sobrou int;
begin
  select count(*) into sobrou
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_public_domain'
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );
  assert sobrou = 0, format('ainda executavel por anon/authenticated: %s', sobrou);
end $$;

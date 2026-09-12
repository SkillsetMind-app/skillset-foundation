\set ON_ERROR_STOP on
begin;

\if :{?without_privileged_aal2_guard}
create or replace function public.privileged_session_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select public.account_session_allowed();
$function$;
\endif

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'PRIVILEGED_MFA_REGRESSION: %', message;
  end if;
end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('85000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.actor(n int, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.uid(n), 'role', 'authenticated', 'aal', aal
  )::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'privileged-mfa-' || n || '@example.test',
  now(), '{}', '{}', now(), now() from generate_series(1, 5) n;
insert into public.users(uid, email, roles, onboarding_completed) values
  (pg_temp.uid(1)::text, 'privileged-mfa-1@example.test', '["admin"]', true),
  (pg_temp.uid(2)::text, 'privileged-mfa-2@example.test', '["ops"]', true),
  (pg_temp.uid(3)::text, 'privileged-mfa-3@example.test', '["support"]', true),
  (pg_temp.uid(4)::text, 'privileged-mfa-4@example.test', '["moderator"]', true),
  (pg_temp.uid(5)::text, 'privileged-mfa-5@example.test', '["student"]', true)
on conflict (uid) do update set roles = excluded.roles;

select pg_temp.actor(1, 'aal1');
set local role authenticated;
select pg_temp.assert_true(not public.is_admin(), 'password-only admin retained is_admin');
select pg_temp.assert_true(not public.is_ops(), 'password-only admin retained is_ops');
select pg_temp.assert_true(not public.is_support(), 'password-only admin retained is_support');
select pg_temp.assert_true(not public.is_moderator(), 'password-only admin retained is_moderator');
reset role;

select pg_temp.actor(2, 'aal1');
set local role authenticated;
select pg_temp.assert_true(not public.is_ops(), 'password-only operator retained is_ops');
reset role;
select pg_temp.actor(3, 'aal1');
set local role authenticated;
select pg_temp.assert_true(not public.is_support(), 'password-only support retained is_support');
reset role;
select pg_temp.actor(4, 'aal1');
set local role authenticated;
select pg_temp.assert_true(not public.is_moderator(), 'password-only moderator retained is_moderator');
reset role;

select pg_temp.actor(1, 'aal2');
set local role authenticated;
select pg_temp.assert_true(public.is_admin() and public.is_ops()
  and public.is_support() and public.is_moderator(), 'AAL2 admin lost role hierarchy');
reset role;
select pg_temp.actor(2, 'aal2');
set local role authenticated;
select pg_temp.assert_true(public.is_ops() and not public.is_admin(), 'AAL2 operator role mismatch');
reset role;
select pg_temp.actor(3, 'aal2');
set local role authenticated;
select pg_temp.assert_true(public.is_support() and not public.is_admin(), 'AAL2 support role mismatch');
reset role;
select pg_temp.actor(4, 'aal2');
set local role authenticated;
select pg_temp.assert_true(public.is_moderator() and not public.is_admin(), 'AAL2 moderator role mismatch');
reset role;
select pg_temp.actor(5, 'aal2');
set local role authenticated;
select pg_temp.assert_true(not public.is_admin() and not public.is_ops()
  and not public.is_support() and not public.is_moderator(), 'AAL2 granted a role absent from the profile');
reset role;

insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before)
values (pg_temp.uid(1)::text, true, null, clock_timestamp());
select pg_temp.actor(1, 'aal2');
set local role authenticated;
select pg_temp.assert_true(not public.is_admin(), 'suspended AAL2 admin retained privileges');
reset role;

select 'operational role MFA smoke passed' as result;
rollback;

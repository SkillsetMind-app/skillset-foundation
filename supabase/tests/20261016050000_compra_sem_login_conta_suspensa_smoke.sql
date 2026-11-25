\set ON_ERROR_STOP on
-- Disposable database. Fixtures are undone at the final rollback.
-- guest_buyer_account_blocked (20261016050000_compra_sem_login_conta_suspensa.sql):
--   - suspended account (with or without a blocked email): true;
--   - account banned in Auth (banned_until in the future): true; expired ban: false;
--   - account with a control row but not suspended, and account without a control row: false;
--   - only service_role executes: anon and authenticated are refused;
--   - this function and find_auth_user_id_by_email (20261016040000) are SECURITY
--     DEFINER with an empty search_path.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'GUEST_BUYER_BLOCKED_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61016050-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.refused(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'GUEST_BUYER_BLOCKED_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;

-- Fixtures: 1 suspended, 2 suspended with a blocked email, 3 control lifted,
-- 4 no control, 5 banned in Auth, 6 expired ban.
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'conta-suspensa-' || n || '@example.test', '{}', '{}', now(), now()
from generate_series(1, 6) n;
update auth.users set banned_until = now() + interval '1 day' where id = pg_temp.uid(5);
update auth.users set banned_until = now() - interval '1 day' where id = pg_temp.uid(6);
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'conta-suspensa-%@example.test'
on conflict (uid) do nothing;
insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before) values
  (pg_temp.uid(1)::text, true, null, now()),
  (pg_temp.uid(2)::text, true, 'bloqueado-2@example.test', now()),
  (pg_temp.uid(3)::text, false, null, now());

-- 1) The server receives only yes or no.
set local role service_role;
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(1)::text), 'suspended');
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(2)::text), 'suspended with blocked email');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(3)::text), 'restored');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(4)::text), 'no control row');
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(5)::text), 'banned in Auth');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(6)::text), 'ban expired');
select pg_temp.assert_true(not public.guest_buyer_account_blocked('does-not-exist'), 'unknown uid');
reset role;

-- 2) Browser (anon and authenticated) does not execute.
select pg_temp.assert_true(not has_function_privilege('anon', 'public.guest_buyer_account_blocked(text)', 'execute'), 'anon privilege');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.guest_buyer_account_blocked(text)', 'execute'), 'authenticated privilege');
set local role anon;
select pg_temp.refused($q$select public.guest_buyer_account_blocked('x')$q$);
reset role;
set local role authenticated;
select pg_temp.refused($q$select public.guest_buyer_account_blocked('x')$q$);
reset role;

-- 3) The two guest-purchase functions: SECURITY DEFINER, empty search_path.
select pg_temp.assert_true((select p.prosecdef from pg_proc p
  where p.oid = 'public.guest_buyer_account_blocked(text)'::regprocedure), 'blocked: security definer');
select pg_temp.assert_true((select p.proconfig from pg_proc p
  where p.oid = 'public.guest_buyer_account_blocked(text)'::regprocedure) = array['search_path=""'], 'blocked: empty search_path');
select pg_temp.assert_true((select p.prosecdef from pg_proc p
  where p.oid = 'public.find_auth_user_id_by_email(text)'::regprocedure), 'lookup: security definer');
select pg_temp.assert_true((select p.proconfig from pg_proc p
  where p.oid = 'public.find_auth_user_id_by_email(text)'::regprocedure) = array['search_path=""'], 'lookup: empty search_path');

rollback;

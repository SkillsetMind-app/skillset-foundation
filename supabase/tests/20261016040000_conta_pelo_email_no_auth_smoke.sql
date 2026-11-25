\set ON_ERROR_STOP on
-- Disposable database. Fixtures undone in the final rollback.
-- find_auth_user_id_by_email (20261016040000_conta_pelo_email_no_auth.sql):
--   - finds the account by the email in auth.users, with spaces and uppercase;
--   - does not find it by public.users.email (editable), nor a deleted account;
--   - unknown email returns null;
--   - only service_role executes: anon and authenticated are refused.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FIND_AUTH_USER_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61016040-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.refused(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'FIND_AUTH_USER_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;

-- Fixtures: 1 normal account, 2 account whose public.users.email was changed,
-- 3 deleted account.
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, deleted_at)
values
  (pg_temp.uid(1), 'authenticated', 'authenticated', 'conta-email-1@example.test', '{}', '{}', now(), now(), null),
  (pg_temp.uid(2), 'authenticated', 'authenticated', 'conta-email-2@example.test', '{}', '{}', now(), now(), null),
  (pg_temp.uid(3), 'authenticated', 'authenticated', 'conta-email-3@example.test', '{}', '{}', now(), now(), now());
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'conta-email-%@example.test'
on conflict (uid) do nothing;
update public.users set email = 'perfil-trocado@example.test' where uid = pg_temp.uid(2)::text;

-- 1) The server finds the account, even with spaces and uppercase.
set local role service_role;
select pg_temp.assert_true(public.find_auth_user_id_by_email('  Conta-Email-1@Example.TEST ') = pg_temp.uid(1), 'auth email lookup');

-- 2) The profile email (editable) does not find an account; the one in auth.users does.
select pg_temp.assert_true(public.find_auth_user_id_by_email('perfil-trocado@example.test') is null, 'profile email is not a lookup');
select pg_temp.assert_true(public.find_auth_user_id_by_email('conta-email-2@example.test') = pg_temp.uid(2), 'auth email of edited profile');

-- 3) Deleted account and unknown email: null.
select pg_temp.assert_true(public.find_auth_user_id_by_email('conta-email-3@example.test') is null, 'deleted account');
select pg_temp.assert_true(public.find_auth_user_id_by_email('ninguem@example.test') is null, 'unknown email');
reset role;

-- 4) Browser (anon and authenticated) does not execute.
select pg_temp.assert_true(not has_function_privilege('anon', 'public.find_auth_user_id_by_email(text)', 'execute'), 'anon privilege');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.find_auth_user_id_by_email(text)', 'execute'), 'authenticated privilege');
set local role anon;
select pg_temp.refused($q$select public.find_auth_user_id_by_email('conta-email-1@example.test')$q$);
reset role;
set local role authenticated;
select pg_temp.refused($q$select public.find_auth_user_id_by_email('conta-email-1@example.test')$q$);
reset role;

rollback;

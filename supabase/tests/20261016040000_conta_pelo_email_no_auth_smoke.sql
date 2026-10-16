\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures desfeitas no rollback final.
-- find_auth_user_id_by_email (20261016040000_conta_pelo_email_no_auth.sql):
--   - acha a conta pelo e-mail de auth.users, com espaco e maiusculas;
--   - nao acha pelo public.users.email (editavel), nem conta apagada;
--   - e-mail desconhecido devolve null;
--   - so o service_role executa: anon e authenticated sao recusados.
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

-- Fixtures: 1 conta normal, 2 conta cujo public.users.email foi trocado,
-- 3 conta apagada.
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

-- 1) O servidor acha a conta, mesmo com espaco e maiusculas.
set local role service_role;
select pg_temp.assert_true(public.find_auth_user_id_by_email('  Conta-Email-1@Example.TEST ') = pg_temp.uid(1), 'auth email lookup');

-- 2) O e-mail do perfil (editavel) nao acha conta; o de auth.users acha.
select pg_temp.assert_true(public.find_auth_user_id_by_email('perfil-trocado@example.test') is null, 'profile email is not a lookup');
select pg_temp.assert_true(public.find_auth_user_id_by_email('conta-email-2@example.test') = pg_temp.uid(2), 'auth email of edited profile');

-- 3) Conta apagada e e-mail desconhecido: null.
select pg_temp.assert_true(public.find_auth_user_id_by_email('conta-email-3@example.test') is null, 'deleted account');
select pg_temp.assert_true(public.find_auth_user_id_by_email('ninguem@example.test') is null, 'unknown email');
reset role;

-- 4) Navegador (anon e authenticated) nao executa.
select pg_temp.assert_true(not has_function_privilege('anon', 'public.find_auth_user_id_by_email(text)', 'execute'), 'anon privilege');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.find_auth_user_id_by_email(text)', 'execute'), 'authenticated privilege');
set local role anon;
select pg_temp.refused($q$select public.find_auth_user_id_by_email('conta-email-1@example.test')$q$);
reset role;
set local role authenticated;
select pg_temp.refused($q$select public.find_auth_user_id_by_email('conta-email-1@example.test')$q$);
reset role;

rollback;

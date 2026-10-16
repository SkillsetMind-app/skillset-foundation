\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures desfeitas no rollback final.
-- guest_buyer_account_blocked (20261016050000_compra_sem_login_conta_suspensa.sql):
--   - conta suspensa (com ou sem e-mail bloqueado): true;
--   - conta banida no Auth (banned_until no futuro): true; ban vencido: false;
--   - conta com controle mas nao suspensa, e conta sem controle: false;
--   - so o service_role executa: anon e authenticated sao recusados;
--   - esta funcao e find_auth_user_id_by_email (20261016040000) sao SECURITY
--     DEFINER com search_path vazio.
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

-- Fixtures: 1 suspensa, 2 suspensa com e-mail bloqueado, 3 controle levantado,
-- 4 sem controle, 5 banida no Auth, 6 ban vencido.
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

-- 1) O servidor recebe so sim ou nao.
set local role service_role;
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(1)::text), 'suspended');
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(2)::text), 'suspended with blocked email');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(3)::text), 'restored');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(4)::text), 'no control row');
select pg_temp.assert_true(public.guest_buyer_account_blocked(pg_temp.uid(5)::text), 'banned in Auth');
select pg_temp.assert_true(not public.guest_buyer_account_blocked(pg_temp.uid(6)::text), 'ban expired');
select pg_temp.assert_true(not public.guest_buyer_account_blocked('nao-existe'), 'unknown uid');
reset role;

-- 2) Navegador (anon e authenticated) nao executa.
select pg_temp.assert_true(not has_function_privilege('anon', 'public.guest_buyer_account_blocked(text)', 'execute'), 'anon privilege');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.guest_buyer_account_blocked(text)', 'execute'), 'authenticated privilege');
set local role anon;
select pg_temp.refused($q$select public.guest_buyer_account_blocked('x')$q$);
reset role;
set local role authenticated;
select pg_temp.refused($q$select public.guest_buyer_account_blocked('x')$q$);
reset role;

-- 3) As duas funcoes da compra sem login: SECURITY DEFINER, search_path vazio.
select pg_temp.assert_true((select p.prosecdef from pg_proc p
  where p.oid = 'public.guest_buyer_account_blocked(text)'::regprocedure), 'blocked: security definer');
select pg_temp.assert_true((select p.proconfig from pg_proc p
  where p.oid = 'public.guest_buyer_account_blocked(text)'::regprocedure) = array['search_path=""'], 'blocked: empty search_path');
select pg_temp.assert_true((select p.prosecdef from pg_proc p
  where p.oid = 'public.find_auth_user_id_by_email(text)'::regprocedure), 'lookup: security definer');
select pg_temp.assert_true((select p.proconfig from pg_proc p
  where p.oid = 'public.find_auth_user_id_by_email(text)'::regprocedure) = array['search_path=""'], 'lookup: empty search_path');

rollback;

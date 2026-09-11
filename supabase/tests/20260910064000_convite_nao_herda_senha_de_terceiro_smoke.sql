\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- P1-1: conta pré-cadastrada por terceiro não vira porta de admin quando o
-- convite chega. O banco efêmero não tem o Supabase Auth: aqui a confirmação
-- do e-mail e as sessões são linhas escritas à mão, e a senha é um hash
-- sintético (só importa se está vazio ou não).
begin;
create temp table invite_checks (name text, passed boolean);
grant insert, select on invite_checks to authenticated;
create function pg_temp.check_invite(p_name text, p_ok boolean) returns void
language sql as $$ insert into invite_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text, p_session uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role,
    'aal', 'aal1', 'session_id', p_session)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

-- 1 admin que convida; 2 conta pré-cadastrada por terceiro (senha dele, sem
-- confirmação); 3 pessoa que já tinha conta confirmada antes do convite.
select pg_temp.act_as(null, 'service_role');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  (pg_temp.uid(1), 'authenticated', 'authenticated', 'invite-issuer@example.test', '', now(), '{}', '{}', now(), now()),
  (pg_temp.uid(2), 'authenticated', 'authenticated', 'invite-precadastro@example.test',
    '$2a$10$syntheticthirdpartyhash', null, '{}', '{}', now(), now()),
  (pg_temp.uid(3), 'authenticated', 'authenticated', 'invite-legit@example.test',
    '$2a$10$syntheticlegitimatehash', now() - interval '30 days', '{}', '{}', now() - interval '30 days', now());
select set_config('skillset.trusted_write', 'on', true);
update public.users set roles = '["admin"]' where uid = pg_temp.uid(1)::text;

select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select public.admin_create_platform_invite('invite-precadastro@example.test', 'admin') ->> 'id' as attack_invite \gset
select public.admin_create_platform_invite('invite-legit@example.test', 'staff') ->> 'id' as legit_invite \gset
reset role;

-- A pessoa convidada clica no link: o e-mail DA CONTA PRÉ-CADASTRADA é
-- confirmado agora, depois de o convite existir. Em seguida há duas sessões:
-- a do link (102) e a de quem pré-cadastrou, que entrou com a senha (202).
update auth.users set email_confirmed_at = clock_timestamp() where id = pg_temp.uid(2);
insert into auth.sessions(id, user_id, created_at, updated_at) values
  (pg_temp.uid(102), pg_temp.uid(2), clock_timestamp(), clock_timestamp()),
  (pg_temp.uid(202), pg_temp.uid(2), clock_timestamp(), clock_timestamp()),
  (pg_temp.uid(103), pg_temp.uid(3), clock_timestamp(), clock_timestamp());

select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(102));
set local role authenticated;
select public.accept_platform_invite(:'attack_invite') as attack_result \gset
reset role;
select pg_temp.check_invite('invite still grants the invited role',
  (select roles ? 'admin' from public.users where uid = pg_temp.uid(2)::text));
select pg_temp.check_invite('pre-registered password does not survive the acceptance',
  (select coalesce(encrypted_password, '') = '' from auth.users where id = pg_temp.uid(2)));
select pg_temp.check_invite('acceptance asks the invitee to sign in again',
  (:'attack_result')::jsonb ->> 'reauthentication_required' = 'true');
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(202));
select pg_temp.check_invite('a session opened before the acceptance is not admin', not public.is_admin());
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(102));
select pg_temp.check_invite('the accepting session is closed too', not public.account_session_allowed());
insert into auth.sessions(id, user_id, created_at, updated_at)
  values (pg_temp.uid(302), pg_temp.uid(2), clock_timestamp(), clock_timestamp());
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(302));
select pg_temp.check_invite('a fresh sign-in after the acceptance is admin', public.is_admin());

-- Controle: conta confirmada antes do convite não perde senha nem sessão.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated', pg_temp.uid(103));
set local role authenticated;
select public.accept_platform_invite(:'legit_invite') as legit_result \gset
reset role;
select pg_temp.check_invite('account confirmed before the invite keeps its password',
  (select encrypted_password = '$2a$10$syntheticlegitimatehash' from auth.users where id = pg_temp.uid(3)));
select pg_temp.act_as(pg_temp.uid(3), 'authenticated', pg_temp.uid(103));
select pg_temp.check_invite('account confirmed before the invite keeps its session',
  public.account_session_allowed() and public.is_ops());
select pg_temp.check_invite('account confirmed before the invite is not asked to sign in again',
  (:'legit_result')::jsonb ->> 'reauthentication_required' = 'false');

-- admin_bootstrap_invites: 4 pré-cadastro com senha, sem confirmação;
-- 5 cadastro que já nasce confirmado e sem senha (Google).
select pg_temp.act_as(null, 'service_role');
insert into public.admin_bootstrap_invites(email, roles) values
  ('bootstrap-precadastro@example.test', '["admin","teacher"]'),
  ('bootstrap-google@example.test', '["admin","teacher"]');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid(4), 'authenticated', 'authenticated', 'bootstrap-precadastro@example.test',
  '$2a$10$syntheticthirdpartyhash', null, '{}', '{}', now(), now());
select pg_temp.check_invite('unconfirmed signup does not receive bootstrap roles',
  (select roles = '["student"]'::jsonb from public.users where uid = pg_temp.uid(4)::text)
  and exists (select 1 from public.admin_bootstrap_invites where email = 'bootstrap-precadastro@example.test'));
update auth.users set email_confirmed_at = clock_timestamp() where id = pg_temp.uid(4);
select pg_temp.check_invite('email confirmation grants the bootstrap roles',
  (select roles ? 'admin' and roles ? 'teacher' from public.users where uid = pg_temp.uid(4)::text)
  and not exists (select 1 from public.admin_bootstrap_invites where email = 'bootstrap-precadastro@example.test'));
select pg_temp.check_invite('bootstrap confirmation drops the pre-registered password',
  (select coalesce(encrypted_password, '') = '' from auth.users where id = pg_temp.uid(4)));
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid(5), 'authenticated', 'authenticated', 'bootstrap-google@example.test',
  '', now(), '{"provider":"google"}', '{}', now(), now());
select pg_temp.check_invite('confirmed signup still receives bootstrap roles at once',
  (select roles ? 'admin' from public.users where uid = pg_temp.uid(5)::text));

select name, passed from invite_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from invite_checks where not passed;
  if failures is not null then
    raise exception 'PLATFORM_INVITE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

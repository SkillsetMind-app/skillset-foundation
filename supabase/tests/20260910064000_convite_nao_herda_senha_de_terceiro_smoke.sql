\set ON_ERROR_STOP on
-- Disposable database only. Fixtures are undone in the ROLLBACK.
--
-- P1-1: an account pre-registered by a third party does not become an admin door when the
-- invite arrives. The ephemeral database has no Supabase Auth: here the email
-- confirmation and the sessions are hand-written rows, and the password is a
-- synthetic hash (all that matters is whether it is empty or not).
begin;
\if :{?without_invite_password_guard}
do $$
declare
  v_definition text := pg_get_functiondef('public.accept_platform_invite(uuid)'::regprocedure);
  v_without_guard text;
begin
  v_without_guard := replace(v_definition,
    'update auth.users set encrypted_password = '''' where id = auth.uid();', 'null;');
  if v_without_guard = v_definition then raise exception 'INVITE_TEST_SETUP_FAILED'; end if;
  execute v_without_guard;
end $$;
\endif
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
    'aal', 'aal2', 'session_id', p_session)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

-- 1 admin who invites; 2 account pre-registered by a third party (their password, no
-- confirmation); 3 person who already had a confirmed account before the invite.
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

-- The invited person clicks the link: the email OF THE PRE-REGISTERED ACCOUNT is
-- confirmed now, after the invite exists. Then there are two sessions:
-- the link's (102) and that of whoever pre-registered, who came in with the password (202).
-- Simulates accounts confirmed before this patch was installed: the accept still
-- needs to clear the credential and revoke its real sessions in Auth.
do $$
declare
  original_definition text := pg_get_functiondef('public.admin_bootstrap_on_email_confirmed()'::regprocedure);
  original_body text := (select prosrc from pg_proc where oid = 'public.admin_bootstrap_on_email_confirmed()'::regprocedure);
begin
  execute replace(original_definition, original_body, 'begin return new; end;');
  update auth.users set email_confirmed_at = clock_timestamp() where id = pg_temp.uid(2);
  execute original_definition;
end $$;
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
select pg_temp.check_invite('old Auth sessions are removed, not only denied by RLS',
  not exists (select 1 from auth.sessions where user_id = pg_temp.uid(2)));
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(202));
select pg_temp.check_invite('a session opened before the acceptance is not admin', not public.is_admin());
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(102));
select pg_temp.check_invite('the accepting session is closed too', not public.account_session_allowed());
insert into auth.sessions(id, user_id, created_at, updated_at)
  values (pg_temp.uid(302), pg_temp.uid(2), clock_timestamp(), clock_timestamp());
select pg_temp.act_as(pg_temp.uid(2), 'authenticated', pg_temp.uid(302));
select pg_temp.check_invite('a fresh sign-in after the acceptance is admin', public.is_admin());

-- Control: an account confirmed before the invite loses neither password nor session.
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

-- admin_bootstrap_invites: 4 pre-registration with password, no confirmation;
-- 5 signup that is born confirmed and without a password (Google).
select pg_temp.act_as(null, 'service_role');
insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  (pg_temp.uid(6), 'authenticated', 'authenticated', 'invite-current@example.test', '$2a$10$syntheticthirdpartyhash', '{}', '{}'),
  (pg_temp.uid(7), 'authenticated', 'authenticated', 'invite-revoked@example.test', '$2a$10$syntheticlegitimatehash', '{}', '{}');
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select public.admin_create_platform_invite('invite-current@example.test', 'admin') ->> 'id' as current_invite \gset
select public.admin_create_platform_invite('invite-revoked@example.test', 'admin') ->> 'id' as revoked_invite \gset
select public.admin_revoke_platform_invite(:'revoked_invite');
reset role;
update auth.users set email_confirmed_at = clock_timestamp() where id in (pg_temp.uid(6), pg_temp.uid(7));
select pg_temp.check_invite('current invite removes password before the first confirmed session',
  (select coalesce(encrypted_password, '') = '' from auth.users where id = pg_temp.uid(6)));
select pg_temp.check_invite('confirmation alone does not accept the platform invitation',
  (select not (roles ? 'admin') from public.users where uid = pg_temp.uid(6)::text));
select pg_temp.check_invite('revoked invite does not reset an unrelated password',
  (select encrypted_password = '$2a$10$syntheticlegitimatehash' from auth.users where id = pg_temp.uid(7)));
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

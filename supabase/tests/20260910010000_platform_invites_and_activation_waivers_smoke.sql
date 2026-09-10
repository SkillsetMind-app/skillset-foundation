\set ON_ERROR_STOP on
-- Disposable database only, after all migrations. Parent owns execution/runner lock.
-- Real Auth fixtures and RPCs; every mutation is rolled back.
begin;
\if :{?without_waiver_ready_guard}
do $$
declare
  v_definition text := pg_get_functiondef('public.creator_activation_blocked(text)'::regprocedure);
  v_without_guard text;
begin
  v_without_guard := replace(v_definition, ' and w.ready_at is not null', '');
  if v_without_guard = v_definition then
    raise exception 'SMOKE_SETUP_FAILED: waiver readiness predicate not found';
  end if;
  execute v_without_guard;
end $$;
\endif
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'SMOKE_ASSERTION_FAILED: %', message; end if; end $$;
create function pg_temp.denied(statement text, expected_state text default '42501') returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'SMOKE_ASSERTION_FAILED: accepted %', statement;
end $$;
create function pg_temp.actor(n integer, aal text default 'aal2') returns void language plpgsql as $$
declare v_uid text := '81000000-0000-4000-8000-' || lpad(n::text, 12, '0');
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated', 'aal', aal)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create temporary table invites(label text primary key, result jsonb not null);
grant all on invites to authenticated, service_role;
create function pg_temp.service_actor() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.invite_id(label text) returns uuid language sql as $$
  select (result->>'id')::uuid from pg_temp.invites i where i.label = $1;
$$;

select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('81000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'platform-invite-' || n || '@example.test',
  case when n <> 6 then now() end, '{}',
  '{"email":"platform-invite-2@example.test","email_verified":true,"roles":["admin"]}'::jsonb, now(), now()
from generate_series(1, 12) n;
-- Match both the CI baseline and production Auth-trigger setup.
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, false from auth.users
where id::text like '81000000-0000-4000-8000-%'
on conflict (uid) do nothing;
update public.users set roles = '["admin"]' where uid = '81000000-0000-4000-8000-000000000001';
update public.users set roles = '["support"]', onboarding_completed = true
  where uid = '81000000-0000-4000-8000-000000000002';
update public.users set roles = '["teacher","student"]', activation_fee_paid_at = '2026-01-02T03:04:05Z'
  where uid = '81000000-0000-4000-8000-000000000008';
update public.users set email = 'platform-invite-2@example.test'
  where uid = '81000000-0000-4000-8000-000000000007';
insert into public.platform_settings(key, value) values ('require_activation_fee', 'true'::jsonb)
  on conflict (key) do update set value = excluded.value;
create temporary table before_profiles as select uid, to_jsonb(u) as profile from public.users u
  where uid like '81000000-0000-4000-8000-%';

select pg_temp.actor(1);
set local role authenticated;
select pg_temp.assert_true(jsonb_typeof(public.admin_list_platform_invites()) = 'array', 'list contract');
insert into invites values ('replaced', public.admin_create_platform_invite(' PLATFORM-INVITE-2@EXAMPLE.TEST ', 'student'));
insert into invites values ('teacher', public.admin_create_platform_invite('platform-invite-2@example.test', 'teacher', true));
insert into invites values ('student', public.admin_create_platform_invite('platform-invite-3@example.test', 'student'));
insert into invites values ('staff', public.admin_create_platform_invite('platform-invite-4@example.test', 'staff'));
insert into invites values ('admin', public.admin_create_platform_invite('platform-invite-5@example.test', 'admin'));
insert into invites values ('unconfirmed', public.admin_create_platform_invite('platform-invite-6@example.test', 'teacher', true));
insert into invites values ('paid', public.admin_create_platform_invite('platform-invite-8@example.test', 'teacher', true));
insert into invites values ('normal', public.admin_create_platform_invite('platform-invite-9@example.test', 'teacher'));
insert into invites values ('expired', public.admin_create_platform_invite('platform-invite-10@example.test', 'student'));
insert into invites values ('revoked', public.admin_create_platform_invite('platform-invite-11@example.test', 'staff'));
insert into invites values ('demoted', public.admin_create_platform_invite('platform-invite-12@example.test', 'admin'));
select public.admin_revoke_platform_invite(pg_temp.invite_id('revoked'));
select public.admin_revoke_platform_invite(pg_temp.invite_id('revoked'));
select pg_temp.denied($q$select public.admin_create_platform_invite('bad email','student')$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite(null,'student')$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('x@example.test','owner')$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('x@example.test',null)$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('x@example.test','teacher',null)$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('student-waiver@example.test','student',true)$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('staff-waiver@example.test','staff',true)$q$, '22023');
select pg_temp.denied($q$select public.admin_create_platform_invite('admin-waiver@example.test','admin',true)$q$, '22023');
select pg_temp.assert_true(not public.creator_activation_blocked(), 'admin exemption changed');
reset role;
select pg_temp.assert_true((select count(*) = 1 from public.platform_invites
  where email = 'platform-invite-2@example.test' and accepted_at is null and revoked_at is null), 'duplicate pending email');
select pg_temp.assert_true((select revoked_at is not null from public.platform_invites
  where id = pg_temp.invite_id('replaced')), 'deliberate renewal did not invalidate old ID');
select pg_temp.assert_true((select bool_and(expires_at - created_at between interval '7 days' and interval '7 days 1 second')
  from public.platform_invites where created_by = auth.uid()::text), 'seven-day expiry');
select pg_temp.denied($q$insert into public.platform_invites(email,access_level,created_by)
  values('platform-invite-2@example.test','admin','81000000-0000-4000-8000-000000000001')$q$, '23505');
-- CHECK also protects privileged writes that bypass the public RPC validation.
select pg_temp.denied($q$insert into public.platform_invites(email,access_level,waive_activation,created_by)
  values('direct-student-waiver@example.test','student',true,'81000000-0000-4000-8000-000000000001')$q$, '23514');
select pg_temp.denied($q$insert into public.platform_invites(email,access_level,waive_activation,created_by)
  values('direct-staff-waiver@example.test','staff',true,'81000000-0000-4000-8000-000000000001')$q$, '23514');
select pg_temp.denied($q$insert into public.platform_invites(email,access_level,waive_activation,created_by)
  values('direct-admin-waiver@example.test','admin',true,'81000000-0000-4000-8000-000000000001')$q$, '23514');
select pg_temp.denied($q$update public.platform_invites set waive_activation=true where id=pg_temp.invite_id('student')$q$, '23514');
select pg_temp.denied($q$update public.platform_invites set access_level='staff' where id=pg_temp.invite_id('teacher')$q$, '23514');
update public.platform_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  where id = pg_temp.invite_id('expired');

-- ACLs deny raw tables even to an authenticated admin; no PUBLIC defaults leak.
set local role authenticated;
select pg_temp.denied('select * from public.platform_invites');
select pg_temp.denied('select * from public.creator_activation_waivers');
select pg_temp.denied($q$insert into public.creator_activation_waivers(uid,granted_by) values(auth.uid()::text,auth.uid()::text)$q$);
select pg_temp.denied('update public.creator_activation_waivers set granted_by = auth.uid()::text');
select pg_temp.denied('delete from public.creator_activation_waivers');
select pg_temp.denied('delete from public.platform_invites');
reset role;
select pg_temp.actor(7);
set local role authenticated;
select pg_temp.denied($q$select public.admin_create_platform_invite('nonadmin@example.test','admin',true)$q$);
select pg_temp.denied('select public.admin_list_platform_invites()');
select pg_temp.denied($q$select public.admin_revoke_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied($q$select public.admin_set_activation_waiver(auth.uid()::text,true)$q$);
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.assert_true(not public.has_creator_activation_waiver(), 'self-edit granted waiver');
reset role;

-- MFA uses verified factors, not an invented global AAL2 requirement.
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','totp','verified',now(),now()),
  ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','totp','verified',now(),now());
select pg_temp.actor(1, 'aal1');
set local role authenticated;
select pg_temp.denied($q$select public.admin_create_platform_invite('mfa@example.test','admin')$q$);
select pg_temp.denied('select public.admin_list_platform_invites()');
select pg_temp.denied($q$select public.admin_revoke_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied($q$select public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000002',true)$q$);
reset role;
select pg_temp.actor(2, 'aal1');
set local role authenticated;
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied('select public.has_creator_activation_waiver()');
reset role;
select pg_temp.actor(6);
set local role authenticated;
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('unconfirmed'))$q$);
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('unconfirmed'))$q$);
reset role;
-- A failed audit rolls back roles, waiver and consumption together.
update auth.users set email_confirmed_at = now() where id = '81000000-0000-4000-8000-000000000006';
alter table public.audit_log add constraint platform_invite_smoke_audit_failure
  check (action <> 'platform_invite.accepted' or actor_id <> '81000000-0000-4000-8000-000000000006') not valid;
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('unconfirmed'))$q$, '23514');
reset role;
alter table public.audit_log drop constraint platform_invite_smoke_audit_failure;
select pg_temp.assert_true((select accepted_at is null from public.platform_invites
  where id = pg_temp.invite_id('unconfirmed')), 'audit failure consumed invitation');
select pg_temp.assert_true(not exists (select 1 from public.creator_activation_waivers
  where uid = '81000000-0000-4000-8000-000000000006'), 'audit failure left waiver');
select pg_temp.assert_true((select to_jsonb(u) = b.profile from public.users u join before_profiles b using(uid)
  where uid = '81000000-0000-4000-8000-000000000006'), 'audit failure left profile changes');
select pg_temp.assert_true(current_setting('skillset.trusted_write',true) = 'off', 'failed acceptance leaked trusted write');
select pg_temp.actor(10);
set local role authenticated;
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('expired'))$q$);
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('expired'))$q$);
reset role;
select pg_temp.actor(1);
set local role authenticated;
insert into invites values ('renewed-expired', public.admin_create_platform_invite('platform-invite-10@example.test','student'));
reset role;
select pg_temp.actor(10);
set local role authenticated;
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('renewed-expired'))->>'next_path' = '/learn', 'expired invitation cannot be renewed deliberately');
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('expired'))$q$);
reset role;
select pg_temp.actor(11);
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('revoked'))$q$);
reset role;

-- Teacher invite preserves existing roles and all legal/verification/payment fields.
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('replaced'))$q$);
select pg_temp.assert_true(public.get_my_platform_invite(pg_temp.invite_id('teacher'))->>'access_level' = 'teacher', 'own read contract');
insert into invites values ('teacher-receipt', public.accept_platform_invite(pg_temp.invite_id('teacher')));
select pg_temp.assert_true((select result->>'next_path' = '/onboarding?path=teacher'
  and result->>'waiver_revision' is not null and (result->>'activation_pending')::boolean
  from invites where label='teacher-receipt'), 'teacher path/revision/pending');
select pg_temp.assert_true(public.has_creator_activation_waiver(), 'explicit invite waiver missing');
select pg_temp.assert_true(public.creator_activation_blocked(), 'pending waiver unlocked activation before cleanup');
select pg_temp.denied($q$select public.finalize_creator_activation_waiver(auth.uid()::text,
  (select (result->>'waiver_revision')::uuid from invites where label='teacher-receipt'))$q$);
reset role;
create temporary table replay_snapshot as select to_jsonb(u) as profile, to_jsonb(w) as waiver,
  (select count(*) from public.audit_log) as audit_count
  from public.users u join public.creator_activation_waivers w using(uid)
  where uid='81000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('teacher'))=
  (select result from invites where label='teacher-receipt'), 'retry changed immutable receipt');
select pg_temp.assert_true(public.get_my_platform_invite(pg_temp.invite_id('teacher'))=
  (select result from invites where label='teacher-receipt'), 'accepted invite cannot be reopened for cleanup retry');
reset role;
select pg_temp.assert_true((select s.profile=to_jsonb(u) and s.waiver=to_jsonb(w)
  and s.audit_count=(select count(*) from public.audit_log)
  from replay_snapshot s, public.users u join public.creator_activation_waivers w using(uid)
  where uid='81000000-0000-4000-8000-000000000002'), 'replay mutated roles/onboarding/waiver/audit');
-- The service-role check still rejects an authenticated claim with owner ACLs.
select pg_temp.denied($q$select public.finalize_creator_activation_waiver(auth.uid()::text,gen_random_uuid())$q$);
select pg_temp.service_actor();
set local role service_role;
select pg_temp.assert_true(public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'waiver_revision')::uuid from invites where label='teacher-receipt')), 'matching revision cannot finalize');
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(not public.creator_activation_blocked('81000000-0000-4000-8000-000000000009'), 'ready waiver failed or UID oracle leaked');
select pg_temp.assert_true(public.get_my_platform_invite(pg_temp.invite_id('teacher'))=
  (select result || '{"activation_pending":false}'::jsonb from invites where label='teacher-receipt'), 'GET did not expose ready status');
reset role;
select pg_temp.assert_true(current_setting('skillset.trusted_write',true) = 'off', 'trusted write leaked');
select pg_temp.assert_true((select roles = '["student","support"]'::jsonb
  and onboarding_path = 'teacher' and not onboarding_completed from public.users
  where uid = '81000000-0000-4000-8000-000000000002'), 'teacher promotion bypassed onboarding or lost roles');
select pg_temp.denied($q$update public.platform_invites set expires_at=expires_at+interval '1 day' where id=pg_temp.invite_id('teacher')$q$);
select pg_temp.denied($q$delete from public.platform_invites where id=pg_temp.invite_id('teacher')$q$);
select pg_temp.assert_true((select count(*) = 1 from public.audit_log where action = 'platform_invite.accepted'
  and target_id = pg_temp.invite_id('teacher')::text), 'acceptance audit missing or replayed');
select pg_temp.assert_true((select accepted_waiver_revision=(accepted_result->>'waiver_revision')::uuid
  from public.platform_invites where id=pg_temp.invite_id('teacher')), 'receipt revision not stored on invitation');
-- Reusing the confirmed email on another account cannot replay an old receipt.
update auth.users set email='platform-invite-moved@example.test' where id='81000000-0000-4000-8000-000000000002';
update auth.users set email='platform-invite-2@example.test' where id='81000000-0000-4000-8000-000000000007';
select pg_temp.actor(7);
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('teacher'))$q$);
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('teacher'))$q$);
reset role;
update auth.users set email='platform-invite-7@example.test' where id='81000000-0000-4000-8000-000000000007';
update auth.users set email='platform-invite-2@example.test',email_confirmed_at=null where id='81000000-0000-4000-8000-000000000002';
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('teacher'))$q$);
reset role;
update auth.users set email_confirmed_at=now() where id='81000000-0000-4000-8000-000000000002';
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.denied($q$select public.admin_revoke_platform_invite(pg_temp.invite_id('teacher'))$q$);
-- A new invite for the same email must not mutate the accepted record or revoke its waiver.
insert into invites values ('after-accepted', public.admin_create_platform_invite('platform-invite-2@example.test','student'));
reset role;
select pg_temp.actor(2);
set local role authenticated;
select public.accept_platform_invite(pg_temp.invite_id('after-accepted'));
select pg_temp.assert_true(public.has_creator_activation_waiver(), 'false invitation revoked existing waiver');
reset role;

select pg_temp.actor(3);
set local role authenticated;
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('student'))->>'next_path' = '/learn', 'student path');
reset role;
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('staff'))->>'next_path' = '/ops', 'staff path');
select pg_temp.assert_true(not public.has_creator_activation_waiver(), 'staff implied waiver');
reset role;
select pg_temp.assert_true((select roles @> '["student","support","moderator","ops"]'::jsonb
  and not roles ? 'admin' and onboarding_completed from public.users
  where uid = '81000000-0000-4000-8000-000000000004'), 'staff role bundle');
select pg_temp.actor(5);
set local role authenticated;
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('admin'))->>'next_path' = '/ops', 'admin path');
reset role;
select pg_temp.assert_true((select roles @> '["student","admin"]'::jsonb and onboarding_completed
  from public.users where uid = '81000000-0000-4000-8000-000000000005'), 'admin role bundle');

-- An admin demotion committed before consumption invalidates the issued grant.
select pg_temp.actor(5);
set local role authenticated;
select public.admin_set_user_roles('81000000-0000-4000-8000-000000000001', '["student"]'::jsonb);
reset role;
select pg_temp.actor(12);
set local role authenticated;
select pg_temp.denied($q$select public.get_my_platform_invite(pg_temp.invite_id('demoted'))$q$);
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('demoted'))$q$);
select pg_temp.assert_true(not public.has_creator_activation_waiver(), 'demoted issuer granted waiver');
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.denied($q$select public.accept_platform_invite(pg_temp.invite_id('teacher'))$q$);
reset role;
select pg_temp.actor(5);
set local role authenticated;
select public.admin_set_user_roles('81000000-0000-4000-8000-000000000001', '["admin"]'::jsonb);
reset role;

-- Paid remains paid through invitation, waiver grant and waiver revocation.
select pg_temp.actor(8);
set local role authenticated;
select public.accept_platform_invite(pg_temp.invite_id('paid'));
select pg_temp.assert_true(not public.creator_activation_blocked(), 'paid invite blocked');
reset role;
select pg_temp.actor(1);
set local role authenticated;
select public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000008', false);
select pg_temp.assert_true(public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000002', false)
  = '{"revision":null}'::jsonb, 'revoke response contract');
select pg_temp.denied($q$select public.admin_set_activation_waiver('missing-user',true)$q$, '22023');
reset role;
select pg_temp.actor(8);
set local role authenticated;
select pg_temp.assert_true(not public.has_creator_activation_waiver() and not public.creator_activation_blocked(), 'revoking waiver erased payment');
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(not public.has_creator_activation_waiver() and public.creator_activation_blocked(), 'unpaid waiver revoke did not restore fee');
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('teacher'))=
  (select result || '{"waive_activation":false,"waiver_revision":null,"activation_pending":false}'::jsonb
    from invites where label='teacher-receipt'), 'revoked waiver still requested cleanup');
select pg_temp.assert_true(not (public.get_my_platform_invite(pg_temp.invite_id('teacher'))->>'waive_activation')::boolean,
  'GET resurrected revoked waiver');
select pg_temp.assert_true(not public.has_creator_activation_waiver(), 'accepted invite replay recreated revoked waiver');
reset role;
select pg_temp.service_actor();
set local role service_role;
select pg_temp.assert_true(not public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'waiver_revision')::uuid from invites where label='teacher-receipt')), 'stale finalizer recreated revoked waiver');
reset role;
select pg_temp.actor(9);
set local role authenticated;
select public.accept_platform_invite(pg_temp.invite_id('normal'));
select pg_temp.assert_true(not public.has_creator_activation_waiver() and public.creator_activation_blocked(), 'normal teacher skipped fee');
select pg_temp.assert_true(public.creator_activation_blocked('81000000-0000-4000-8000-000000000008'), 'paid UID oracle leaked');
reset role;
select pg_temp.actor(1);
set local role authenticated;
insert into invites values ('waiver-r1', public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000002', true));
insert into invites values ('waiver-r2', public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000002', true));
select pg_temp.assert_true((select result->>'revision' is not null from invites where label='waiver-r2')
  and (select result from invites where label='waiver-r1')<>(select result from invites where label='waiver-r2'), 'regrant reused revision');
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(public.has_creator_activation_waiver() and public.creator_activation_blocked(), 'regrant did not reset readiness');
select pg_temp.assert_true(public.accept_platform_invite(pg_temp.invite_id('teacher')) @>
  '{"waive_activation":false,"waiver_revision":null,"activation_pending":false}'::jsonb, 'old invite selected newer waiver revision');
reset role;
select pg_temp.assert_true((select revision=(select (result->>'revision')::uuid from invites where label='waiver-r2')
  and ready_at is null from public.creator_activation_waivers where uid='81000000-0000-4000-8000-000000000002'), 'retry overwrote newer waiver revision');
select pg_temp.service_actor();
set local role service_role;
select pg_temp.assert_true(not public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'revision')::uuid from invites where label='waiver-r1')), 'superseded revision finalized');
select pg_temp.assert_true(public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'revision')::uuid from invites where label='waiver-r2')), 'current revision did not finalize');
select pg_temp.assert_true(public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'revision')::uuid from invites where label='waiver-r2')), 'finalizer retry not idempotent');
reset role;
select pg_temp.assert_true((select count(*)=2 from public.audit_log where action='creator_activation_waiver.ready'
  and target_id='81000000-0000-4000-8000-000000000002'), 'finalizer replay duplicated audit');
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(not public.creator_activation_blocked(), 'ready replacement failed to unlock');
reset role;
select pg_temp.actor(1);
set local role authenticated;
insert into invites values ('waiver-r3', public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000002', true));
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(public.has_creator_activation_waiver() and public.creator_activation_blocked(), 'upsert of ready waiver did not become pending');
reset role;
select pg_temp.service_actor();
set local role service_role;
select pg_temp.assert_true(not public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'revision')::uuid from invites where label='waiver-r2')), 'ready revision finalized its replacement');
select pg_temp.assert_true(public.finalize_creator_activation_waiver('81000000-0000-4000-8000-000000000002',
  (select (result->>'revision')::uuid from invites where label='waiver-r3')), 'ready replacement cleanup could not finish');
reset role;
select pg_temp.actor(9);
set local role authenticated;
select pg_temp.assert_true(public.creator_activation_blocked('81000000-0000-4000-8000-000000000002'), 'waived UID oracle leaked');
reset role;
update public.platform_settings set value = 'false'::jsonb where key = 'require_activation_fee';
set local role authenticated;
select pg_temp.assert_true(not public.creator_activation_blocked(), 'flag-off behavior changed');
reset role;

-- Sensitive evidence is identical, including the real paid timestamp, not fabricated.
select pg_temp.assert_true(not exists (
  select 1 from public.users u join before_profiles b using(uid)
  cross join unnest(array['terms_accepted_at','terms_version','privacy_accepted_at','privacy_version',
    'teacher_terms_accepted_at','teacher_terms_version','creator_verification_status',
    'activation_fee_paid_at','stripe_connect_charges_enabled','stripe_connect_payouts_enabled']) f(field)
  where to_jsonb(u)->f.field is distinct from b.profile->f.field
), 'invites/waivers changed legal, verification or payment evidence');
select pg_temp.assert_true(not exists (select 1 from public.enrollments where user_id like '81000000-0000-4000-8000-%'), 'platform invite granted a course');
select pg_temp.assert_true((select accepted_at is null from public.platform_invites where id=pg_temp.invite_id('demoted')), 'failed acceptance consumed invite');
select pg_temp.assert_true(exists (select 1 from public.audit_log where action='creator_activation_waiver.revoked'
  and target_id='81000000-0000-4000-8000-000000000008'), 'waiver revoke missing audit');

-- Real self-onboarding payloads, after proving invites never fabricated terms.
-- Legal timestamps below represent this explicit smoke acceptance, not an invite.
select pg_temp.actor(2);
set local role authenticated;
update public.users set roles='["teacher"]', teacher_terms_accepted_at='2026-09-10T01:00:00Z',
  teacher_terms_version='smoke-explicit-terms', onboarding_completed=true where uid=auth.uid()::text;
select pg_temp.assert_true((select roles='["support","teacher"]'::jsonb and onboarding_completed
  and teacher_terms_version='smoke-explicit-terms' from public.users where uid=auth.uid()::text), 'onboarding dropped existing support');
select public.accept_platform_invite(pg_temp.invite_id('teacher'));
select pg_temp.assert_true((select roles='["support","teacher"]'::jsonb and onboarding_completed
  from public.users where uid=auth.uid()::text), 'receipt replay reset completed onboarding or roles');
select pg_temp.denied($q$update public.users set roles='["teacher","ops"]' where uid=auth.uid()::text$q$);
select pg_temp.denied($q$update public.users set roles='["teacher","support","admin"]' where uid=auth.uid()::text$q$);
select pg_temp.denied($q$update public.users set roles='{"admin":true}' where uid=auth.uid()::text$q$, '22023');
select pg_temp.denied($q$update public.users set roles='[null]' where uid=auth.uid()::text$q$, '22023');
-- A normal onboarding write does not open any of the existing protected fields.
select pg_temp.denied($q$update public.users set roles='["student"]',activation_fee_paid_at=now() where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set creator_verification_status='approved' where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_connected_account_id='acct_smoke_forbidden' where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_connect_status='connected' where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_connect_charges_enabled=not coalesce(stripe_connect_charges_enabled,false) where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_connect_payouts_enabled=not coalesce(stripe_connect_payouts_enabled,false) where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_connect_updated_at=now() where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set stripe_customer_id='cus_smoke_forbidden' where uid=auth.uid()::text$q$, 'P0001');
select pg_temp.denied($q$update public.users set current_plan_id='smoke_forbidden_plan' where uid=auth.uid()::text$q$, 'P0001');
reset role;
select pg_temp.actor(4);
set local role authenticated;
update public.users set roles='["teacher"]', teacher_terms_accepted_at='2026-09-10T01:00:00Z',
  teacher_terms_version='smoke-explicit-terms', onboarding_completed=true where uid=auth.uid()::text;
select pg_temp.assert_true((select roles='["moderator","ops","support","teacher"]'::jsonb
  from public.users where uid=auth.uid()::text), 'onboarding dropped staff bundle');
-- A caller that retains the exact privileged set may also change student/teacher.
update public.users set roles='["student","teacher","support","ops","moderator"]' where uid=auth.uid()::text;
select pg_temp.assert_true((select roles @> '["student","teacher","support","ops","moderator"]'::jsonb
  from public.users where uid=auth.uid()::text), 'unchanged staff set rejected');
select pg_temp.denied($q$update public.users set roles='["teacher","support","ops"]' where uid=auth.uid()::text$q$);
select pg_temp.denied($q$update public.users set roles='["teacher","support","ops","moderator","admin"]' where uid=auth.uid()::text$q$);
reset role;
select pg_temp.actor(5);
set local role authenticated;
update public.users set roles='["teacher"]', teacher_terms_accepted_at='2026-09-10T01:00:00Z',
  teacher_terms_version='smoke-explicit-terms', onboarding_completed=true where uid=auth.uid()::text;
select pg_temp.assert_true((select roles='["admin","teacher"]'::jsonb and onboarding_completed
  from public.users where uid=auth.uid()::text), 'admin early return lost admin during onboarding');
select pg_temp.denied($q$update public.users set roles='["teacher","admin","ops"]' where uid=auth.uid()::text$q$);
reset role;
select pg_temp.actor(9);
set local role authenticated;
select pg_temp.denied($q$update public.users set roles='["teacher","support","ops","moderator"]' where uid=auth.uid()::text$q$);
-- An INSERT ... ON CONFLICT path must not accept privileged client roles either.
select pg_temp.denied($q$insert into public.users(uid,roles) values(auth.uid()::text,'["ops"]') on conflict(uid) do nothing$q$);
reset role;

-- Existing MFA RLS remains effective for direct profile onboarding updates.
select pg_temp.actor(2, 'aal1');
set local role authenticated;
with changed as (update public.users set roles='["student"]' where uid=auth.uid()::text returning uid)
select pg_temp.assert_true((select count(*)=0 from changed), 'pending MFA updated onboarding profile');
reset role;
select pg_temp.assert_true((select roles='["support","teacher"]'::jsonb from public.users
  where uid='81000000-0000-4000-8000-000000000002'), 'pending MFA changed roles');

-- Another admin still owns role-management authority; no automatic merge on its target.
select pg_temp.actor(1);
set local role authenticated;
select public.admin_set_user_roles('81000000-0000-4000-8000-000000000004','["student"]'::jsonb);
select public.admin_set_user_roles('81000000-0000-4000-8000-000000000005','["student"]'::jsonb);
reset role;
select pg_temp.assert_true((select bool_and(roles='["student"]'::jsonb) from public.users
  where uid in ('81000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000005')), 'external admin demotion was merged away');

-- Historical accepted fixture: cleanup-only retry outlives invitation expiry.
select pg_temp.actor(1);
set local role authenticated;
insert into invites values ('expired-retry-waiver', public.admin_set_activation_waiver('81000000-0000-4000-8000-000000000006', true));
reset role;
insert into public.platform_invites(id,email,access_level,waive_activation,created_by,created_at,expires_at,
  accepted_at,accepted_by,accepted_waiver_revision,accepted_result)
select '83000000-0000-4000-8000-000000000001', 'platform-invite-6@example.test','teacher',true,
  '81000000-0000-4000-8000-000000000001',now()-interval '10 days',now()-interval '3 days',now()-interval '5 days',
  '81000000-0000-4000-8000-000000000006',(result->>'revision')::uuid,
  jsonb_build_object('id','83000000-0000-4000-8000-000000000001','email','platform-invite-6@example.test',
    'access_level','teacher','waive_activation',true,'created_at',now()-interval '10 days',
    'expires_at',now()-interval '3 days','accepted_at',now()-interval '5 days','revoked_at',null,
    'roles','["student"]'::jsonb,'next_path','/onboarding?path=teacher',
    'waiver_revision',result->>'revision','activation_pending',true)
from invites where label='expired-retry-waiver';
select pg_temp.actor(6);
set local role authenticated;
select pg_temp.assert_true((public.get_my_platform_invite('83000000-0000-4000-8000-000000000001')->>'activation_pending')::boolean,
  'expired accepted invitation hid cleanup retry');
select pg_temp.assert_true((public.accept_platform_invite('83000000-0000-4000-8000-000000000001')->>'activation_pending')::boolean,
  'expired accepted invitation rejected cleanup retry');
reset role;

-- The aggregate must consume an ordered, limited subquery, not LIMIT its one row.
insert into public.platform_invites(email,access_level,created_by,created_at,expires_at)
select 'platform-list-' || n || '@example.test', 'student', '81000000-0000-4000-8000-000000000001',
  now() + n * interval '1 second', now() + interval '7 days' + n * interval '1 second'
from generate_series(1, 205) n;
create temporary table expected_invite_list as
  select jsonb_agg(to_jsonb(i) order by i.created_at desc, i.id) as result
  from (select * from public.platform_invites order by created_at desc, id limit 200) i;
grant select on expected_invite_list to authenticated;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.admin_list_platform_invites())=200, 'list exceeds latest 200');
select pg_temp.assert_true(public.admin_list_platform_invites()=(select result from expected_invite_list), 'list is not the latest 200 in order');
reset role;

-- PUBLIC/anon cannot discover invites or use even the own-waiver RPC.
set local role anon;
select pg_temp.denied('select * from public.platform_invites');
select pg_temp.denied('select * from public.creator_activation_waivers');
select pg_temp.denied($q$select public.admin_create_platform_invite('anon@example.test','admin')$q$);
select pg_temp.denied('select public.admin_list_platform_invites()');
select pg_temp.denied('select public.admin_revoke_platform_invite(gen_random_uuid())');
select pg_temp.denied('select public.get_my_platform_invite(gen_random_uuid())');
select pg_temp.denied('select public.accept_platform_invite(gen_random_uuid())');
select pg_temp.denied($q$select public.admin_set_activation_waiver('missing-user',true)$q$);
select pg_temp.denied('select public.has_creator_activation_waiver()');
select pg_temp.denied($q$select public.finalize_creator_activation_waiver('missing-user',gen_random_uuid())$q$);
reset role;
select pg_temp.assert_true(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
  where n.nspname='public' and p.proname in ('admin_create_platform_invite','admin_list_platform_invites',
    'admin_revoke_platform_invite','get_my_platform_invite','accept_platform_invite',
    'admin_set_activation_waiver','has_creator_activation_waiver','finalize_creator_activation_waiver',
    'platform_invite_acceptance_result','audit_platform_access_change')
    and a.grantee=0 and a.privilege_type='EXECUTE'
), 'PUBLIC execute survived');
select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.platform_invite_acceptance_result(public.platform_invites)','EXECUTE'), 'private receipt helper callable by client');
rollback;

-- Parent's optional two-connection race check on committed disposable fixtures:
-- A: BEGIN; SELECT public.accept_platform_invite(:id); -- leave open
-- B: SELECT public.accept_platform_invite(:id);         -- same caller waits, then gets A's stored receipt
-- B alternatives: admin_revoke_platform_invite(:id) rejects after A COMMIT;
-- admin_create_platform_invite(:email,...) creates a fresh ID, never rewrites A's accepted row.
-- Demotion first: A UPDATE public.users SET roles='["student"]' WHERE uid=:issuer;
-- B accept waits on the issuer row, then rejects after A COMMIT.
-- Acceptance first: B demotion waits on the issuer row until acceptance commits.
-- These concurrent schedules are not claimed as executed by this single-session smoke.

\set ON_ERROR_STOP on
-- Disposable database only. All fixtures, reversals and synthetic deletes roll back.
begin;
\if :{?without_account_session_guard}
create or replace function public.account_session_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select true; $$;
\endif

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'ACCOUNT_CONTROL_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('83000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.actor(n int, aal text default 'aal2', session_id text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n),
    'role', 'authenticated', 'aal', aal, 'session_id', coalesce(session_id, pg_temp.uid(n + 100)::text))::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.change(n int, action text, reason text default 'Synthetic operational reason') returns jsonb language sql as $$
  select public.admin_set_account_control(pg_temp.uid(n)::text, action, reason);
$$;
create function pg_temp.denied(statement text, message text default null, state text default '42501') returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = state and (message is null or sqlerrm = message) then return; end if;
    raise;
  end;
  raise exception 'ACCOUNT_CONTROL_REGRESSION: forbidden operation succeeded';
end $$;

select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'account-control-' || n || '@example.test',
  now(), '{}', '{}', now(), now() from generate_series(1, 6) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where id::text like '83000000-0000-4000-8000-%'
on conflict (uid) do nothing;
update public.users set roles = '["admin"]' where uid in (pg_temp.uid(1)::text, pg_temp.uid(3)::text);
update public.users set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid = pg_temp.uid(2)::text;
-- A forged profile email must never select the blocked address.
update public.users set email = 'unrelated-profile@example.test' where uid = pg_temp.uid(2)::text;
insert into auth.sessions(id, user_id, created_at, updated_at)
select pg_temp.uid(n + 100), pg_temp.uid(n), now() - interval '1 day', now() from generate_series(1, 6) n;
insert into public.courses(id, owner_id, slug, title, summary, category, status, payment_type, currency, price_amount_minor)
values ('account-control-course', pg_temp.uid(2)::text, 'account-control-course', 'Account control fixture',
  'Synthetic private course.', 'smoke', 'draft', 'free', 'USD', 0);
insert into public.course_lesson_content(lesson_id, course_id, content_text)
values ('account-control-lesson', 'account-control-course', 'SYNTHETIC_PRIVATE_CONTENT');
insert into storage.objects(bucket_id, name)
values ('course-content', 'courses/account-control-course/assets/check.txt');
create temporary table profiles_before as select uid, to_jsonb(u) as profile from public.users u
  where uid::text like '83000000-0000-4000-8000-%';

-- Positive controls before restriction: the exact reads that must disappear.
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(public.account_session_allowed(), 'unrestricted session rejected');
select pg_temp.assert_true(exists(select 1 from public.users where uid = pg_temp.uid(2)::text), 'profile positive control');
select pg_temp.assert_true(exists(select 1 from public.course_lesson_content where lesson_id = 'account-control-lesson'), 'lesson positive control');
select pg_temp.assert_true(exists(select 1 from storage.objects where name = 'courses/account-control-course/assets/check.txt'), 'storage positive control');
select pg_temp.assert_true((public.upsert_course_commerce_settings('account-control-course', false, '[]'::jsonb)->>'success')::boolean, 'course owner RPC positive control');
select pg_temp.denied($q$select pg_temp.change(4, 'suspend')$q$, 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED');
select pg_temp.denied($q$select public.admin_get_account_control(pg_temp.uid(4)::text)$q$, 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED');
reset role;

-- No MFA enrolment is necessary to demonstrate aal1 refusal for this new power.
select pg_temp.actor(1, 'aal1');
set local role authenticated;
select pg_temp.denied($q$select pg_temp.change(2, 'block')$q$, 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED');
reset role;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.denied($q$select pg_temp.change(1, 'suspend')$q$, 'ACCOUNT_CONTROL_SELF');
select pg_temp.denied($q$select pg_temp.change(2, 'delete')$q$, 'ACCOUNT_CONTROL_INVALID_INPUT', '22023');
select pg_temp.denied($q$select pg_temp.change(2, null)$q$, 'ACCOUNT_CONTROL_INVALID_INPUT', '22023');
select pg_temp.denied($q$select pg_temp.change(2, 'suspend', '  ')$q$, 'ACCOUNT_CONTROL_INVALID_INPUT', '22023');
select pg_temp.denied($q$select pg_temp.change(2, 'suspend', repeat('x', 501))$q$, 'ACCOUNT_CONTROL_INVALID_INPUT', '22023');
select pg_temp.denied($q$select pg_temp.change(90, 'suspend')$q$, 'ACCOUNT_CONTROL_USER_MISSING', '23503');
select pg_temp.denied('select * from public.account_controls');
select pg_temp.denied($q$update public.account_controls set suspended = false$q$);
select pg_temp.denied('delete from public.account_controls');
select pg_temp.assert_true((public.admin_get_account_control(pg_temp.uid(1)::text)->>'is_self')::boolean, 'self status');
select pg_temp.change(2, 'suspend');
reset role;

-- Same JWT/session_id, now after the operation committed within this transaction.
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.users where uid = pg_temp.uid(2)::text), 'suspended session read private profile');
select pg_temp.assert_true(not public.account_session_allowed() and not public.session_is_strong(), 'suspended aal2 passed session gate');
select pg_temp.assert_true(not public.is_teacher(), 'suspended account retained operational role');
select pg_temp.assert_true(not exists(select 1 from public.course_lesson_content where lesson_id = 'account-control-lesson'), 'suspended owner read lesson');
select pg_temp.assert_true(not exists(select 1 from storage.objects where name = 'courses/account-control-course/assets/check.txt'), 'suspended owner read storage');
with changed as (update public.users set bio = 'forbidden' where uid = pg_temp.uid(2)::text returning uid)
select pg_temp.assert_true(not exists(select 1 from changed), 'suspended user updated profile');
select pg_temp.denied($q$insert into storage.objects(bucket_id, name) values ('course-content','courses/account-control-course/assets/forbidden.txt')$q$);
select pg_temp.denied($q$select public.record_lesson_playback('account-control-course','account-control-lesson',1)$q$);
-- Co-producer RPCs were removed by the July 24 migration. Exercise the current
-- commerce RPC, which calls assert_course_owner from its DECLARE initializer.
select pg_temp.denied($q$select public.upsert_course_commerce_settings('account-control-course',false,'[]'::jsonb)$q$);
select pg_temp.denied($q$select public.admin_set_user_roles(pg_temp.uid(2)::text,'["admin"]')$q$);
reset role;

-- Blocking upgrades suspension without trusting the editable profile email.
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.change(2, 'block', '  Synthetic block reason  ');
select pg_temp.assert_true(public.admin_get_account_control(pg_temp.uid(2)::text)->>'blocked_email' = 'account-control-2@example.test', 'block trusted profile email');
select pg_temp.change(2, 'suspend');
select pg_temp.assert_true(public.admin_get_account_control(pg_temp.uid(2)::text)->>'blocked_email' = 'account-control-2@example.test', 'suspend cleared existing email block');
select pg_temp.change(3, 'suspend');
select pg_temp.denied($q$select pg_temp.change(1, 'block')$q$, 'ACCOUNT_CONTROL_LAST_ADMIN');
select pg_temp.denied($q$select public.admin_set_user_roles(pg_temp.uid(1)::text, '["student"]')$q$, 'You cannot remove your own admin role.');
select pg_temp.assert_true(exists(select 1 from public.users where uid = pg_temp.uid(1)::text and roles ? 'admin'), 'role downgrade removed last active administrator');
reset role;
select pg_temp.actor(3);
set local role authenticated;
select pg_temp.denied($q$select pg_temp.change(1, 'restore')$q$, 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED');
select pg_temp.denied($q$select public.admin_list_platform_users()$q$);
select pg_temp.denied($q$select public.admin_set_user_roles(pg_temp.uid(1)::text, '["student"]')$q$);
select pg_temp.assert_true(not public.is_admin(), 'suspended administrator remained authorized');
reset role;

-- Auth updates and registrations use the trigger, not any application form.
select pg_temp.actor(1);
select pg_temp.denied($q$update auth.users set email = 'moved@example.test' where id = pg_temp.uid(2)$q$, 'Account registration is unavailable.');
select pg_temp.denied($q$update auth.users set email = ' ACCOUNT-CONTROL-2@EXAMPLE.TEST ' where id = pg_temp.uid(4)$q$, 'Account registration is unavailable.');
set local role authenticated;
select pg_temp.change(5, 'block');
reset role;
-- Synthetic fixture only: prove the tombstone survives deletion of Auth identity.
delete from auth.users where id = pg_temp.uid(5);
\if :{?without_account_email_guard}
-- The migration owns this function, not the Supabase-managed auth.users table.
-- Remove only our guard body; the transaction restores it after the RED proof.
create or replace function public.guard_blocked_account_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin return new; end;
$$;
\endif
do $$
begin
  begin
    insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (pg_temp.uid(50), 'authenticated', 'authenticated', ' ACCOUNT-CONTROL-5@EXAMPLE.TEST ',
        '{"provider":"google"}', '{"roles":["admin"]}', now(), now());
  exception when sqlstate '42501' then
    if sqlerrm = 'Account registration is unavailable.' then return; end if;
    raise;
  end;
  raise exception 'ACCOUNT_CONTROL_REGRESSION: blocked email registered again';
end $$;

-- Audit failure rolls back the state, block and cutoff together.
create function public.account_control_smoke_reject_audit() returns trigger language plpgsql as $$
begin if new.metadata->>'reason' = 'reject-audit-fixture' then raise exception 'SYNTHETIC_AUDIT_FAILURE'; end if; return new; end $$;
create trigger account_control_smoke_reject_audit before insert on public.audit_log
for each row execute function public.account_control_smoke_reject_audit();
set local role authenticated;
select pg_temp.denied($q$select pg_temp.change(4, 'block', 'reject-audit-fixture')$q$, 'SYNTHETIC_AUDIT_FAILURE', 'P0001');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.account_controls where uid = pg_temp.uid(4)::text), 'failed audit persisted restriction');
select pg_temp.assert_true(exists(select 1 from public.audit_log where target_id = pg_temp.uid(2)::text
  and action = 'user.account_block' and actor_id = pg_temp.uid(1)::text
  and metadata->>'reason' = 'Synthetic block reason' and metadata->'previous'->>'suspended' = 'true'
  and metadata->'next'->>'blocked_email' = 'account-control-2@example.test'), 'transactional audit missing facts');

-- Restore removes the email block but rejects missing, old and foreign sessions.
set local role authenticated;
select pg_temp.change(2, 'restore');
select pg_temp.assert_true(public.admin_get_account_control(pg_temp.uid(2)::text)->>'blocked_email' is null, 'restore retained block');
reset role;
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert_true(not public.account_session_allowed(), 'restore resurrected old session');
reset role;
select pg_temp.actor(2, 'aal2', pg_temp.uid(101)::text);
set local role authenticated;
select pg_temp.assert_true(not public.account_session_allowed(), 'foreign session accepted');
reset role;
select pg_temp.actor(2, 'aal2', '');
set local role authenticated;
select pg_temp.assert_true(not public.account_session_allowed(), 'missing session accepted after restore');
reset role;
insert into auth.sessions(id, user_id, created_at, updated_at)
values (pg_temp.uid(202), pg_temp.uid(2), clock_timestamp(), clock_timestamp());
select pg_temp.actor(2, 'aal2', pg_temp.uid(202)::text);
set local role authenticated;
select pg_temp.assert_true(public.account_session_allowed(), 'fresh login rejected after restore');
select pg_temp.assert_true(exists(select 1 from public.course_lesson_content where lesson_id = 'account-control-lesson'), 'restored owner lost lesson');
reset role;
-- Every existing RLS table and private storage uses the independent deny policy.
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity
    and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
    and not exists(select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'account_access_guard'
      and not p.polpermissive and p.polcmd = '*' and 'authenticated'::regrole::oid = any(p.polroles)
      and pg_get_expr(p.polqual,p.polrelid) like '%account_session_allowed%'
      and pg_get_expr(p.polwithcheck,p.polrelid) like '%account_session_allowed%')
), 'RLS table lacks restrictive session guard');
-- Catalogue coverage is supplemental to the behavioral checks above. Unknown
-- exposed definers fail the smoke instead of silently bypassing suspension.
-- Exceptions do not authorize private data: certificate public verification,
-- available public slug selection, and the activation predicate (denies access;
-- its server callers and course writes have independent account guards).
do $$
declare missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.proname not in ('account_session_allowed','verify_skillset_certificate','course_title_key_available','creator_activation_blocked')
    and p.prosrc !~* '(account_session_allowed|session_is_strong|require_strong_session|assert_course_owner|is_admin|is_teacher|is_support|is_moderator|is_ops|is_target_author)';
  if missing is not null then raise exception 'ACCOUNT_CONTROL_REGRESSION: unguarded authenticated definers: %', missing; end if;
end $$;
select pg_temp.assert_true(not exists(select 1 from profiles_before b join public.users u using(uid)
  where b.profile is distinct from to_jsonb(u)), 'account operation changed profile roles names or billing');

-- Public catalogue and service jobs keep their own authorization boundaries.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.assert_true(public.account_session_allowed(), 'anonymous public access rejected');
select count(*) from public.courses;
select pg_temp.denied($q$select pg_temp.change(4,'suspend')$q$);
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.assert_true(exists(select 1 from public.users where uid = pg_temp.uid(3)::text), 'service job lost suspended user');
select pg_temp.denied($q$select pg_temp.change(4,'suspend')$q$);
reset role;
rollback;

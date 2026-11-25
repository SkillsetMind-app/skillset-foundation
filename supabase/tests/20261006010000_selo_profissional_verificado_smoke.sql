\set ON_ERROR_STOP on
-- Disposable database only. Fixtures are undone in the ROLLBACK.
--
-- "Verified professional" badge in public_profiles
-- (20261006010000_selo_profissional_verificado.sql):
--   - the badge requires status 'approved' AND an approved case; the date is only that of the
--     review (reviewed_at), never made up;
--   - for the public there are only two kinds: 'license' and 'evidence';
--   - revoking or deleting the case removes the badge; approval through the queue RPC and
--     a direct fix of the case both reproject;
--   - "none" and "pending" are tested with a real row in public_profiles
--     (since 20261006020000 every teacher with a complete signup has the
--     row), so that the absence of the badge does not pass just because the row does not exist;
--   - the badge does not touch updated_at (the directory sorts by it);
--   - anon reads the new columns and still cannot read what is private.
begin;
create temp table badge_checks (name text, passed boolean);
grant insert, select on badge_checks to anon, authenticated;
create function pg_temp.check_badge(p_name text, p_ok boolean) returns void
language sql as $$ insert into badge_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61006000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Public row of teacher n, or null if it does not exist.
create function pg_temp.pp(n int) returns public.public_profiles language sql as $$
  select * from public.public_profiles where uid = pg_temp.uid(n)::text;
$$;
-- Number of rows the query returned, or -1 if it was refused.
create function pg_temp.rows_or_denied(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;
-- true only when the database refused the write through the constraint; the one that went through is undone.
create function pg_temp.violates_check(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when check_violation then return true;
  when sqlstate 'Z0001' then return false;
end $$;

-- 1 approved psychologist · 2 teacher "none" · 3 coach with a pending request
-- 4 approved with a case without reviewed_at (legacy) · 5 approved with no case at all
-- 6 ops who reviews · 7 holistic approved
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
-- Domain outside the ones reserved for tests: a test account never gets a public
-- profile (20261006020000), and here the rows need to exist.
select pg_temp.uid(n), 'authenticated', 'authenticated', 'badge-' || n || '@smoke.skillsetmind.com',
  now(), '{}', '{}', now(), now()
from generate_series(1, 7) n;
update public.users set roles = '["student","teacher"]', display_name = 'Selo ' || right(uid, 1),
    teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 7) n where n <> 6);
update public.users set roles = '["student","ops"]' where uid = pg_temp.uid(6)::text;

insert into public.creator_verification_cases
  (creator_id, status, verification_kind, profession, registration_type, registration_id,
   registration_region, reviewed_at)
values
  (pg_temp.uid(1)::text, 'approved', 'psychologist', 'Psychologist', '', 'SMOKE-REG-0001', 'NY',
   '2026-09-01 12:00:00+00'),
  (pg_temp.uid(3)::text, 'pending', 'coach', 'Coach', '', '', '', null),
  (pg_temp.uid(7)::text, 'approved', 'holistic', 'Reiki', '', '', '', '2026-09-03 12:00:00+00');
-- Old admission: kind 'legacy' (default) and no reviewed_at.
insert into public.creator_verification_cases
  (creator_id, status, profession, registration_type, registration_id, registration_region)
values (pg_temp.uid(4)::text, 'approved', 'Psychologist', 'Registry', 'SMOKE-REG-0004', 'NY');
update public.users set creator_verification_status = 'approved'
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text, pg_temp.uid(5)::text, pg_temp.uid(7)::text);
update public.users set creator_verification_status = 'pending' where uid = pg_temp.uid(3)::text;

select pg_temp.check_badge('approved psychologist: license with the review date',
  (select verified_professional and verification_kind = 'license'
          and verified_at = '2026-09-01 12:00:00+00' from pg_temp.pp(1)));
select pg_temp.check_badge('approved case without reviewed_at: evidence, undated',
  (select verified_professional and verification_kind = 'evidence' and verified_at is null
     from pg_temp.pp(4)));
select pg_temp.check_badge('approved without any case: published, but no badge',
  (select not verified_professional and verification_kind is null and verified_at is null
     from pg_temp.pp(5)));
select pg_temp.check_badge('holistic is indistinguishable from coach: evidence',
  (select verified_professional and verification_kind = 'evidence' from pg_temp.pp(7)));
select pg_temp.check_badge('the registration number never reaches the public row',
  not exists (select 1 from public.public_profiles pp
               where to_jsonb(pp)::text like '%SMOKE-REG%'));

-- "none" and "pending" with a real row: a teacher with a complete signup
-- has a public profile without verification (20261006020000).
select pg_temp.check_badge('none and pending teachers have a public row',
  (pg_temp.pp(2)).uid is not null and (pg_temp.pp(3)).uid is not null);
-- Approved case with the user still at "none": the status rules, no badge.
insert into public.creator_verification_cases
  (creator_id, status, verification_kind, profession, registration_type, registration_id,
   registration_region, reviewed_at)
values (pg_temp.uid(2)::text, 'approved', 'psychologist', 'Psychologist', '', 'SMOKE-REG-0002', 'NY', now());
-- Pending: touching the case fires the new trigger, and the badge stays absent.
update public.creator_verification_cases set verification_kind = 'holistic'
  where creator_id = pg_temp.uid(3)::text;
select pg_temp.check_badge('status none with an approved case: row exists, no badge',
  (select not verified_professional and verification_kind is null from pg_temp.pp(2)));
select pg_temp.check_badge('pending: row exists, no badge',
  (select not verified_professional and verification_kind is null from pg_temp.pp(3)));

-- Approval through the real path: the queue RPC, called by ops.
select id as coach_case from public.creator_verification_cases
  where creator_id = pg_temp.uid(3)::text \gset
select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
select pg_temp.check_badge('ops approves through the review RPC',
  (public.review_creator_verification(:'coach_case', 'approved')->>'success')::boolean);
reset role;
select pg_temp.check_badge('approval through the RPC: evidence with the review date',
  (select pp.verified_professional and pp.verification_kind = 'evidence'
          and pp.verified_at = c.reviewed_at and c.reviewed_at is not null
     from public.public_profiles pp
     join public.creator_verification_cases c on c.creator_id = pp.uid
    where pp.uid = pg_temp.uid(3)::text));

-- Direct fix on the case, without touching users: the new trigger reprojects, and the
-- badge does not touch updated_at. The old date comes first: inside the transaction
-- now() is constant, and comparing with the current value would pass even with a bump.
update public.public_profiles set updated_at = '2020-01-01 00:00:00+00'
  where uid = pg_temp.uid(3)::text;
select pg_temp.act_as(null, 'service_role');
update public.creator_verification_cases set verification_kind = 'psychologist'
  where id = :'coach_case';
select pg_temp.check_badge('fixing the case kind reprojects the badge',
  (select verification_kind = 'license' from pg_temp.pp(3)));
select pg_temp.check_badge('the badge does not touch updated_at (directory order)',
  (select updated_at = '2020-01-01 00:00:00+00' from pg_temp.pp(3)));

-- Revoke the case (approved -> rejected) with the user still approved.
update public.creator_verification_cases set status = 'rejected'
  where creator_id = pg_temp.uid(1)::text;
select pg_temp.check_badge('revoking the case clears the badge',
  (select not verified_professional and verification_kind is null and verified_at is null
     from pg_temp.pp(1)));

-- Delete the case.
delete from public.creator_verification_cases where id = :'coach_case';
select pg_temp.check_badge('deleting the case clears the badge',
  (select not verified_professional and verification_kind is null and verified_at is null
     from pg_temp.pp(3)));

-- Left the approval: the badge goes away, and the row stays (the profile does not depend on it).
select set_config('skillset.trusted_write', 'on', true);
update public.users set creator_verification_status = 'rejected' where uid = pg_temp.uid(7)::text;
select pg_temp.check_badge('losing the approval removes the badge, not the profile',
  (select not verified_professional and verification_kind is null and verified_at is null
     from pg_temp.pp(7)));

-- The invariant lives in the database.
select pg_temp.check_badge('constraint refuses a badge without a kind',
  pg_temp.violates_check(format(
    'update public.public_profiles set verification_kind = null where uid = %L', pg_temp.uid(4)::text)));
select pg_temp.check_badge('constraint refuses a kind without the badge',
  pg_temp.violates_check(format(
    'update public.public_profiles set verified_professional = false where uid = %L', pg_temp.uid(4)::text)));
select pg_temp.check_badge('constraint refuses the private kinds (coach, holistic...)',
  pg_temp.violates_check(format(
    'update public.public_profiles set verification_kind = %L where uid = %L', 'coach', pg_temp.uid(4)::text)));
select pg_temp.check_badge('only license or evidence reach the public row',
  not exists (select 1 from public.public_profiles
               where verification_kind is not null and verification_kind not in ('license', 'evidence')));

-- Nothing private becomes a public column.
select pg_temp.check_badge('public_profiles has no private verification column',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'public_profiles'
                 and column_name in ('registration_id', 'registration_region', 'registration_type',
                                     'evidence_links', 'document_path', 'profession', 'note',
                                     'review_note', 'reviewed_by', 'creator_verification_status')));
select pg_temp.check_badge('anon cannot call the badge functions',
  not has_function_privilege('anon', 'public.public_professional_badge(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sync_public_professional_badge()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.public_professional_badge(text)', 'EXECUTE'));
select pg_temp.check_badge('the projection owner can call the badge helper',
  has_function_privilege(
    (select proowner from pg_proc where oid = 'public.sync_public_profile()'::regprocedure),
    'public.public_professional_badge(text)', 'EXECUTE'));

-- Anonymous visitor.
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_badge('anon reads the new columns',
  (select verified_professional and verification_kind = 'evidence' and verified_at is null
     from public.public_profiles where uid = pg_temp.uid(4)::text));
select pg_temp.check_badge('anon cannot read verification cases',
  pg_temp.rows_or_denied(format(
    'select registration_id from public.creator_verification_cases where creator_id in (%L, %L)',
    pg_temp.uid(2)::text, pg_temp.uid(4)::text)) in (0, -1));
select pg_temp.check_badge('anon cannot read the private users row',
  pg_temp.rows_or_denied(format(
    'select creator_verification_status from public.users where uid = %L',
    pg_temp.uid(4)::text)) in (0, -1));
reset role;

select name, passed from badge_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from badge_checks where not passed;
  if failures is not null then
    raise exception 'PROFESSIONAL_BADGE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

\set ON_ERROR_STOP on
-- Disposable Supabase DB only, after migrations. Never run against production.
-- SQL exercises real RPC/RLS guards; MIME/content enforcement at the Storage
-- HTTP API is represented by bucket configuration, not a simulated file upload.
begin;
set local storage.allow_delete_query = 'true';
create function pg_temp.check_badge(p_ok boolean, p_name text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end;
$$;
create function pg_temp.badge_session(p_uid uuid, p_role text default 'authenticated', p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', p_aal)::text, true);
end;
$$;
-- A successful statement is rolled back too. Unexpected errors fail the test;
-- missing functions, fixture mistakes and unrelated constraints cannot pass it.
create function pg_temp.badge_error(p_sql text, p_state text, p_message text default null) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception when others then
  if sqlstate = 'Z0001' then return false; end if;
  if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then return true; end if;
  raise;
end;
$$;

select gen_random_uuid() as coach, gen_random_uuid() as psychologist,
  gen_random_uuid() as other_teacher, gen_random_uuid() as student,
  gen_random_uuid() as ops, gen_random_uuid() as admin, gen_random_uuid() as legacy,
  gen_random_uuid() as document_id, gen_random_uuid() as unused_id \gset
select :'coach' || '/' || :'document_id' || '.pdf' as document_path,
  :'coach' || '/' || :'unused_id' || '.png' as unused_path,
  :'coach' || '/' || :'unused_id' || '.pdf' as missing_path \gset
select pg_temp.badge_session(null, 'service_role');
insert into auth.users(id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select id::uuid, 'authenticated', 'authenticated', id || '@example.invalid', now(), now(), now(), '{}', '{}'
from unnest(array[:'coach', :'psychologist', :'other_teacher', :'student', :'ops', :'admin', :'legacy']) id;
update public.users set roles = '["student","teacher"]', creator_verification_status = 'none'
where uid in (:'coach', :'psychologist', :'other_teacher', :'legacy');
update public.users set roles = '["student"]' where uid = :'student';
update public.users set roles = '["student","ops"]' where uid = :'ops';
update public.users set roles = '["student","admin"]' where uid = :'admin';
insert into public.creator_verification_cases(creator_id,status,profession,registration_type,registration_id,registration_region)
values (:'legacy','approved','Psychologist','Registry','AB123','NY');
update public.users set creator_verification_status = 'approved' where uid = :'legacy';
select pg_temp.check_badge((select verification_kind = 'legacy' and document_path is null
  from public.creator_verification_cases where creator_id = :'legacy'), 'old approvals stay generic legacy');
select pg_temp.check_badge((select not public and file_size_limit = 10485760
  and allowed_mime_types @> array['image/png','image/jpeg','image/webp','application/pdf']
  and cardinality(allowed_mime_types) = 4 from storage.buckets where id = 'verification-evidence'), 'private bucket limits');
select pg_temp.check_badge(not has_function_privilege('anon',
  'public.submit_professional_badge(text,text,text,text,jsonb,text,text)', 'EXECUTE'), 'anonymous RPC grant denied');

select pg_temp.badge_session(null, 'anon');
set local role anon;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'["https://example.org/proof"]')$$,
  '42501'), 'anonymous submission denied');
reset role;
select pg_temp.badge_session(:'student');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'["https://example.org/proof"]')$$,
  '42501', 'Only authenticated teachers can request a professional badge.'), 'nonteacher denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'insert into storage.objects(bucket_id,name) values (''verification-evidence'',%L)',
  :'student' || '/' || :'document_id' || '.pdf'), '42501'), 'nonteacher own-path upload denied');
reset role;

select pg_temp.badge_session(:'coach');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(format(
  'insert into storage.objects(bucket_id,name) values (''verification-evidence'',%L)',
  :'other_teacher' || '/' || :'document_id' || '.pdf'), '42501'), 'wrong-owner upload denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'insert into storage.objects(bucket_id,name) values (''verification-evidence'',%L)',
  :'coach' || '/not-a-uuid.pdf'), '42501'), 'malformed upload path denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'insert into storage.objects(bucket_id,name) values (''verification-evidence'',%L)',
  :'coach' || '/' || :'document_id' || '.exe'), '42501'), 'unsupported extension denied');
insert into storage.objects(bucket_id,name) values
  ('verification-evidence', :'document_path'), ('verification-evidence', :'unused_path');
select pg_temp.check_badge((select count(*) = 2 from storage.objects
  where bucket_id = 'verification-evidence' and name in (:'document_path', :'unused_path')), 'owner reads uploads');
with changed as (update storage.objects set metadata = '{"changed":true}'
  where bucket_id = 'verification-evidence' and name = :'document_path' returning id)
select pg_temp.check_badge((select count(*) = 0 from changed), 'evidence updates denied');
with deleted as (delete from storage.objects where bucket_id = 'verification-evidence' and name = :'unused_path' returning id)
select pg_temp.check_badge((select count(*) = 1 from deleted), 'unreferenced owner delete allowed');
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'unused_path'), 'unreferenced upload removed');
-- Keep an actual orphan for the owner/ops/admin privacy checks below.
insert into storage.objects(bucket_id,name) values ('verification-evidence', :'unused_path');
select pg_temp.check_badge(exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'unused_path'), 'owner reads own orphan');

select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(%L,''Coach'',p_evidence_links=>''["https://example.org/proof"]'')', kind),
  'P0001','Invalid professional verification kind.'), 'invalid kind ' || coalesce(kind, 'NULL'))
from unnest(array['legacy','doctor','',null]) kind;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach')$$,
  'P0001','Provide at least one evidence link or uploaded document.'), 'no evidence denied');
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>null)$$,
  'P0001','Provide at least one evidence link or uploaded document.'), 'null evidence denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''coach'',%L,p_evidence_links=>''["https://example.org/proof"]'')', profession),
  'P0001','Describe your profession (2-120 characters).'), 'profession bounds')
from unnest(array['x',repeat('x',121),null]) profession;
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''coach'',''Coach'',p_evidence_links=>%L::jsonb)', jsonb_build_array(url)),
  'P0001','Evidence links must be valid https URLs (max 300 characters each).'), 'invalid HTTPS host or URL')
from unnest(array['http://example.org','https://','https:///proof','https://user@example.org','https://user:pass@example.org',
  'https://-bad.example.org','https://example..org','https://example.org:0','https://example.org:65536',
  'https://example.org/a b','https://example.org/' || repeat('a',281)]) url;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'[42]')$$,
  'P0001','Evidence links must be valid https URLs (max 300 characters each).'), 'nonstring link denied');
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'{}')$$,
  'P0001','Evidence links must be a list of URLs.'), 'nonarray links denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''coach'',''Coach'',p_evidence_links=>%L::jsonb)',
  (select jsonb_agg('https://example.org'::text) from generate_series(1,7))),
  'P0001','Attach at most 6 evidence links.'), 'seventh link denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''coach'',''Coach'',p_document_path=>%L)',
  :'other_teacher' || '/' || :'document_id' || '.pdf'),
  'P0001','Document must use your own evidence upload path.'), 'foreign document denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''coach'',''Coach'',p_document_path=>%L)', :'missing_path'),
  'P0001','Upload the evidence document before submitting.'), 'missing object denied');
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_document_path=>'https://example.org/file.pdf')$$,
  'P0001','Document must use your own evidence upload path.'), 'raw document URL denied');

select set_config('skillset.trusted_write','off',true);
select pg_temp.check_badge(public.submit_professional_badge('coach','Coach', p_document_path=>:'document_path')
  = '{"success":true}'::jsonb, 'coach document-only exact return contract');
select pg_temp.check_badge(current_setting('skillset.trusted_write') = 'off', 'trusted-write off restored');
select pg_temp.check_badge((select status = 'pending' and verification_kind = 'coach' and profession = 'Coach'
  and registration_type = '' and registration_id = '' and registration_region = ''
  and document_path = :'document_path' and evidence_links = '[]' and reviewed_at is null
  from public.creator_verification_cases where creator_id = :'coach'), 'coach needs no invented license and is not approved');
select id as coach_case from public.creator_verification_cases where creator_id = :'coach' \gset
select pg_temp.check_badge((select creator_verification_status = 'pending' and activation_fee_paid_at is null
  from public.users where uid = :'coach'), 'submission only marks pending; does not charge or activate');
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'["https://example.org/proof"]')$$,
  'P0001','Your verification is already in review.'), 'pending duplicate refused');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.review_creator_verification(%L,''approved'')', :'coach_case'),
  'P0001','Only the operations team can review verification cases.'), 'teacher cannot self-approve');
with deleted as (delete from storage.objects where bucket_id = 'verification-evidence' and name = :'document_path' returning id)
select pg_temp.check_badge((select count(*) = 0 from deleted), 'referenced owner delete denied');
reset role;

select pg_temp.badge_session(:'other_teacher');
set local role authenticated;
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'other teacher cannot read document');
select pg_temp.check_badge(not exists(select 1 from public.creator_verification_cases where id = :'coach_case'),
  'other teacher cannot read private case');
reset role;
select pg_temp.badge_session(null,'anon');
set local role anon;
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'anonymous document read denied');
reset role;

select pg_temp.badge_session(:'ops');
set local role authenticated;
select pg_temp.check_badge(exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'ops reads referenced evidence');
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'unused_path'), 'ops cannot read orphan evidence');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.review_creator_verification(%L,''needs_changes'',''short'')', :'coach_case'),
  'P0001','Add a review note (at least 12 characters) when requesting changes or rejecting.'), 'review note guard retained');
select public.review_creator_verification(:'coach_case','needs_changes','Please supply clearer evidence.');
reset role;
select pg_temp.badge_session(:'coach');
set local role authenticated;
select set_config('skillset.trusted_write','on',true);
select pg_temp.check_badge(public.submit_professional_badge('holistic','Holistic practitioner',
  p_evidence_links=>'["https://example.org:443/proof"]',p_document_path=>:'document_path') = '{"success":true}'::jsonb,
  'holistic resubmission accepted');
select pg_temp.check_badge(current_setting('skillset.trusted_write') = 'on', 'enclosing trusted-write scope restored');
select set_config('skillset.trusted_write','off',true);
select pg_temp.check_badge((select count(*) = 1 from public.creator_verification_cases where creator_id = :'coach')
  and exists(select 1 from public.creator_verification_cases where id = :'coach_case' and status = 'pending'
    and verification_kind = 'holistic' and review_note is null and reviewed_by is null and reviewed_at is null),
  'needs_changes reuses case and clears review metadata');
reset role;

-- A verified factor makes aal1 genuinely weak; no helper is stubbed.
select pg_temp.badge_session(null,'service_role');
insert into auth.mfa_factors(id,user_id,factor_type,status,friendly_name,created_at,updated_at)
values (gen_random_uuid(),:'coach','totp','verified','badge-smoke',now(),now()),
  (gen_random_uuid(),:'ops','totp','verified','badge-smoke',now(),now());
select pg_temp.badge_session(:'coach','authenticated','aal1');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'["https://example.org/proof"]')$$,
  '42501','Complete the second authentication factor.'), 'weak-session RPC denied before pending guard');
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'weak owner cannot read evidence');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'insert into storage.objects(bucket_id,name) values (''verification-evidence'',%L)', :'missing_path'),
  '42501'), 'weak owner cannot upload');
with deleted as (delete from storage.objects where bucket_id = 'verification-evidence' and name = :'document_path' returning id)
select pg_temp.check_badge((select count(*) = 0 from deleted), 'weak owner cannot delete');
reset role;
select pg_temp.badge_session(:'ops','authenticated','aal1');
set local role authenticated;
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'weak ops cannot read evidence');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.review_creator_verification(%L,''approved'')', :'coach_case'),
  '42501','Complete the second authentication factor.'), 'review security wrapper retained');
reset role;

select pg_temp.badge_session(:'psychologist');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('psychologist','Psychologist',p_evidence_links=>'["https://example.org/proof"]')$$,
  'P0001','Add your registration number (2-80 characters).'), 'psychologist missing license denied');
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('psychologist','Psychologist','AB123',p_evidence_links=>'["https://example.org/proof"]')$$,
  'P0001','Add the issuing country or state (2-80 characters).'), 'psychologist missing region denied');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''psychologist'',''Psychologist'',%L,''NY'',''["https://example.org/proof"]'')', license),
  'P0001','Add your registration number (2-80 characters).'), 'license bounds')
from unnest(array['x',repeat('x',81)]) license;
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.submit_professional_badge(''psychologist'',''Psychologist'',''AB123'',%L,''["https://example.org/proof"]'')', region),
  'P0001','Add the issuing country or state (2-80 characters).'), 'region bounds')
from unnest(array['x',repeat('x',81)]) region;
select pg_temp.check_badge(public.submit_professional_badge('psychologist','Psychologist',' AB123 ',' NY ',
  '["https://example.org/proof"]') = '{"success":true}'::jsonb, 'licensed psychologist exact return contract');
select pg_temp.check_badge(exists(select 1 from public.creator_verification_cases where creator_id = :'psychologist'
  and status = 'pending' and verification_kind = 'psychologist' and registration_id = 'AB123'
  and registration_region = 'NY' and document_path is null), 'license never auto-approves psychologist');
reset role;

select pg_temp.badge_session(:'admin');
set local role authenticated;
select pg_temp.check_badge(exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'document_path'), 'admin reads referenced evidence');
select pg_temp.check_badge(not exists(select 1 from storage.objects where bucket_id = 'verification-evidence'
  and name = :'unused_path'), 'admin cannot read orphan evidence');
select public.review_creator_verification(:'coach_case','approved');
select pg_temp.check_badge(pg_temp.badge_error(format(
  'select public.review_creator_verification(%L,''rejected'',''This review is already final.'')', :'coach_case'),
  'P0001','Only pending cases can be reviewed.'), 'second review refused');
reset role;
select pg_temp.badge_session(:'coach');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('coach','Coach',p_evidence_links=>'["https://example.org/proof"]')$$,
  'P0001','Your professional verification is already approved.'), 'approved resubmission refused');
reset role;
select pg_temp.badge_session(:'legacy');
set local role authenticated;
select pg_temp.check_badge(pg_temp.badge_error(
  $$select public.submit_professional_badge('psychologist','Psychologist','AB123','NY','["https://example.org/proof"]')$$,
  'P0001','Your professional verification is already approved.'), 'legacy approval cannot become psychologist badge');
reset role;

-- Legacy RPC remains callable, and resets typed metadata on needs_changes.
select pg_temp.badge_session(:'other_teacher');
set local role authenticated;
select public.submit_professional_badge('other','Mentor',p_evidence_links=>'["https://example.org/proof"]');
select id as other_case from public.creator_verification_cases where creator_id = :'other_teacher' \gset
reset role;
select pg_temp.badge_session(:'ops');
set local role authenticated;
select public.review_creator_verification(:'other_case','needs_changes','Please provide another certificate.');
reset role;
select pg_temp.badge_session(:'other_teacher');
set local role authenticated;
select set_config('skillset.trusted_write','on',true);
select pg_temp.check_badge(public.submit_creator_verification('Mentor','Certificate','AB123','NY',
  '["https://example.org/proof"]') = '{"success":true}'::jsonb, 'legacy return contract retained');
select pg_temp.check_badge(current_setting('skillset.trusted_write') = 'on', 'legacy trusted-write scope restored');
select set_config('skillset.trusted_write','off',true);
select pg_temp.check_badge(exists(select 1 from public.creator_verification_cases where id = :'other_case'
  and verification_kind = 'legacy' and document_path is null and status = 'pending'), 'legacy resubmission stays generic');
reset role;

-- Catalog checks complement behavior; concurrency itself requires two sessions.
select pg_temp.check_badge((select prosrc ilike '%for update%' from pg_proc
  where oid = 'public.submit_professional_badge(text,text,text,text,jsonb,text,text)'::regprocedure), 'new submit locks');
select pg_temp.check_badge((select prosrc like '%where u.uid = v_uid for update%' from pg_proc
  where oid = 'public.submit_creator_verification(text,text,text,text,jsonb,text)'::regprocedure), 'legacy shares user lock');
select pg_temp.check_badge((select prosrc like '%where id = p_case_id for update%'
  and prosrc like '%perform 1 from public.users%' from pg_proc
  where oid = 'public.review_creator_verification(uuid,text,text)'::regprocedure), 'review locks user then case');
select 'professional badge smoke passed' as result;
rollback;

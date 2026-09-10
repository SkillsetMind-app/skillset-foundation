\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Advisor de performance do Supabase sobre a bolsa de acesso de criador:
-- 3 FKs sem indice de cobertura (course_access_grants.claimed_by,
-- course_access_grants.granted_by, enrollments.creator_grant_id) e a policy
-- course_access_grants_owner_select reavaliando auth.uid() a cada linha.
-- Este smoke prova as duas coisas: os 3 indices existem, e a policy recriada
-- continua deixando cada dono ver so os proprios grants -- nunca os de outro
-- criador, nunca os de um aluno qualquer.
begin;
create temp table fk_idx_policy_checks (name text, passed boolean);
grant insert, select on fk_idx_policy_checks to authenticated;
create function pg_temp.check_it(p_name text, p_ok boolean) returns void
language sql as $$ insert into fk_idx_policy_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('90910000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal1')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

-- Os 3 indices do advisor (unindexed_foreign_keys).
select pg_temp.check_it('course_access_grants.claimed_by has a covering index',
  to_regclass('public.course_access_grants_claimed_by_idx') is not null);
select pg_temp.check_it('course_access_grants.granted_by has a covering index',
  to_regclass('public.course_access_grants_granted_by_idx') is not null);
select pg_temp.check_it('enrollments.creator_grant_id has a covering index',
  to_regclass('public.enrollments_creator_grant_id_idx') is not null);

-- 1 dono do curso A, 2 dono do curso B, 3 aluno sem curso e sem grant nenhum.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'fk-idx-policy-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 3) n;
insert into public.courses(id, owner_id, slug, title, summary, category, status, community_enabled)
values
  ('smoke-fk-idx-course-a', pg_temp.uid(1)::text, 'smoke-fk-idx-course-a-slug', 'Course A', 'Course for isolated FK/policy smoke tests.', 'smoke', 'published', false),
  ('smoke-fk-idx-course-b', pg_temp.uid(2)::text, 'smoke-fk-idx-course-b-slug', 'Course B', 'Course for isolated FK/policy smoke tests.', 'smoke', 'published', false);
insert into public.course_access_grants(course_id, learner_email, granted_by)
values
  ('smoke-fk-idx-course-a', 'fk-idx-policy-learner-a@example.test', pg_temp.uid(1)::text),
  ('smoke-fk-idx-course-b', 'fk-idx-policy-learner-b@example.test', pg_temp.uid(2)::text);
select id as grant_a from public.course_access_grants where course_id = 'smoke-fk-idx-course-a' \gset
select id as grant_b from public.course_access_grants where course_id = 'smoke-fk-idx-course-b' \gset

-- O dono do curso A so ve o proprio grant, nunca o do curso B.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_it('course owner sees their own grant',
  exists(select from public.course_access_grants where id = :'grant_a'));
select pg_temp.check_it('course owner does not see another creator''s grant',
  not exists(select from public.course_access_grants where id = :'grant_b'));
select pg_temp.check_it('course owner sees exactly one grant row total',
  (select count(*) = 1 from public.course_access_grants));
reset role;

-- Simetrico: o dono do curso B so ve o proprio, nunca o do curso A.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_it('the other course owner sees only their own grant',
  (select count(*) = 1 from public.course_access_grants where id = :'grant_b')
  and not exists(select from public.course_access_grants where id = :'grant_a'));
reset role;

-- Um aluno sem curso e sem grant proprio nao ve grant de ninguem.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_it('a student who owns no course and holds no grant sees none',
  not exists(select from public.course_access_grants));
reset role;

select name, passed from fk_idx_policy_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from fk_idx_policy_checks where not passed;
  if failures is not null then
    raise exception 'FK_INDEX_OR_POLICY_REGRESSION: %', failures;
  end if;
end $$;
rollback;

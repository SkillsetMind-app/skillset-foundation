\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures desfeitas no rollback final.
--
-- Mais de uma area por professor: Starter fica so com a principal, Pro cria ate
-- 2 extras. O produto B vai para a extra "turma-2": o aluno so de A ve a
-- principal e nao a extra; o aluno so de B ve a extra e nao a principal. Plano
-- caiu: a extra segue no ar para o aluno e travada para o professor.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'MEMBER_AREAS_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('91113023-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated', p_aal text default 'aal2')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', p_aal)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(statement text, state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = state then return; end if;
    raise;
  end;
  raise exception 'MEMBER_AREAS_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;
create function pg_temp.plan(p_plan text) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(null, 'service_role');
  perform set_config('skillset.trusted_write', 'on', true);
  update public.users set current_plan_id = p_plan where uid = pg_temp.uid(1)::text;
end $$;
create function pg_temp.ids(products jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(p ->> 'course_id' order by n), '{}') from jsonb_array_elements(products) with ordinality t(p, n);
$$;

-- 1 professor, 2 aluno so de A, 3 aluno so de B, 4 outro professor.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'member-areas-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'member-areas-%@example.test'
on conflict (uid) do nothing;
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-member-areas-plan-' || n, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (4)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);

insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, product_format, community_enabled)
values
  ('smoke-ma-a', pg_temp.uid(1)::text, 'smoke-ma-a', 'Smoke areas A', 'Curso A.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'course', true),
  ('smoke-ma-b', pg_temp.uid(1)::text, 'smoke-ma-b', 'Smoke areas B', 'Curso B.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'course', true),
  ('smoke-ma-c', pg_temp.uid(1)::text, 'smoke-ma-c', 'Smoke areas C', 'Comunidade C.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'community', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
values (pg_temp.uid(2)::text || '__smoke-ma-a', pg_temp.uid(2)::text, 'smoke-ma-a', 'smoke-ma-a',
  'Smoke areas A', 'smoke', '', 'active', 'admin'),
  (pg_temp.uid(3)::text || '__smoke-ma-b', pg_temp.uid(3)::text, 'smoke-ma-b', 'smoke-ma-b',
  'Smoke areas B', 'smoke', '', 'active', 'admin');
insert into public.public_profiles(uid, display_name, username)
values (pg_temp.uid(1)::text, 'Areas Teacher', 'smoke-member-areas');

-- 1) O espelho do plano.
select pg_temp.assert_true(public.member_area_limit_for_plan(null) = 1 and public.member_area_limit_for_plan('basic') = 1
  and public.member_area_limit_for_plan('starter') = 1 and public.member_area_limit_for_plan('pro') = 3
  and public.member_area_limit_for_plan('plus') = 3, 'plan limits');

-- 2) Starter: so a principal.
select pg_temp.plan('starter');
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.refused($$select public.create_my_member_area('Turma 2', 'turma-2')$$, 'P0001');
reset role;

-- 3) Pro: ate 2 extras, endereco valido e unico.
select pg_temp.plan('pro');
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.refused($$select public.create_my_member_area('x', 'community')$$, '22023');
select pg_temp.refused($$select public.create_my_member_area('x', 'Bad Slug')$$, '22023');
select pg_temp.refused($$select public.create_my_member_area('x', '-x')$$, '22023');
select set_config('smoke.area2', public.create_my_member_area('Turma 2', 'turma-2')::text, true);
select pg_temp.refused($$select public.create_my_member_area('x', 'turma-2')$$, '23505');
select public.create_my_member_area('Turma 3', 'turma-3');
select pg_temp.refused($$select public.create_my_member_area('x', 'turma-4')$$, 'P0001');
-- B vai para a turma-2; C e a comunidade dela.
select public.save_my_member_area_products('[{"course_id": "smoke-ma-b"}]',
  (select id from public.member_areas where slug = 'turma-2'));
select public.set_my_member_area_community('smoke-ma-c', (select id from public.member_areas where slug = 'turma-2'));
select pg_temp.assert_true(pg_temp.ids(public.get_member_area_home('@smoke-member-areas') -> 'more_products')
  = array['smoke-ma-c', 'smoke-ma-a'] or pg_temp.ids(public.get_member_area_home('@smoke-member-areas') -> 'more_products')
  = array['smoke-ma-a', 'smoke-ma-c'], 'main area keeps A and C, not B');
select pg_temp.assert_true(pg_temp.ids(public.get_member_area_home('@smoke-member-areas', 'turma-2') -> 'more_products')
  = array['smoke-ma-b'], 'turma-2 holds only B');
select pg_temp.assert_true(public.get_member_area_home('@smoke-member-areas', 'nope') is null, 'unknown slug');
reset role;

-- 4) Outro professor nao mexe nas areas do primeiro.
select pg_temp.act_as(pg_temp.uid(4));
set local role authenticated;
select pg_temp.refused(format($$select public.save_my_member_area('x', 'dark', null, null, %L)$$,
  current_setting('smoke.area2')), '42501');
select pg_temp.refused(format($$select public.delete_my_member_area(%L)$$, current_setting('smoke.area2')), '22023');
reset role;

-- 5) Cada aluno ve a area do que comprou.
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true(pg_temp.ids(public.get_member_area_home('@smoke-member-areas') -> 'my_products')
  = array['smoke-ma-a'], 'student of A sees the main area');
select pg_temp.assert_true(public.get_member_area_home('@smoke-member-areas', 'turma-2') is null,
  'student of A stays out of turma-2');
select pg_temp.assert_true(not public.has_community_access('smoke-ma-c'), 'student of A stays out of turma-2 community');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
set local role authenticated;
select pg_temp.assert_true(public.get_member_area_home('@smoke-member-areas') is null, 'student of B stays out of the main area');
select pg_temp.assert_true((select d #>> '{area,slug}' = 'turma-2' and d #>> '{area,name}' = 'Turma 2'
    and pg_temp.ids(d -> 'my_products') = array['smoke-ma-b']
  from (select public.get_member_area_home('@smoke-member-areas', 'turma-2') d) x), 'student of B sees turma-2');
select pg_temp.assert_true(public.has_community_access('smoke-ma-c'), 'student of B reaches turma-2 community');
select pg_temp.assert_true((select public.get_member_area_community('@smoke-member-areas', 'turma-2') ->> 'course_id')
  = 'smoke-ma-c', 'turma-2 home learns its community');
select pg_temp.assert_true((select array_agg(s.slug) = array['turma-2']
  from public.get_member_area_slugs(array['smoke-ma-a', 'smoke-ma-b']) s), 'link of B points to turma-2');
reset role;

-- 6) Plano caiu: a extra segue no ar, travada para o professor.
select pg_temp.plan('starter');
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.refused(format($$select public.save_my_member_area('x', 'dark', null, null, %L)$$,
  (select id from public.member_areas where slug = 'turma-2')), '42501');
select pg_temp.refused($$select public.save_my_member_area_products('[{"course_id": "smoke-ma-b"}]')$$, '42501');
select pg_temp.refused($$select public.create_my_member_area('x', 'turma-5')$$, 'P0001');
select public.save_my_member_area('Principal', 'dark', null, null);
reset role;
select pg_temp.act_as(pg_temp.uid(3));
set local role authenticated;
select pg_temp.assert_true(pg_temp.ids(public.get_member_area_home('@smoke-member-areas', 'turma-2') -> 'my_products')
  = array['smoke-ma-b'], 'locked area stays open for the student');
reset role;

-- 7) Apagar a extra devolve B para a principal.
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select public.delete_my_member_area((select id from public.member_areas where slug = 'turma-2'));
select pg_temp.refused($$select public.delete_my_member_area((select id from public.member_areas where slug is null))$$, '22023');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
set local role authenticated;
select pg_temp.assert_true(pg_temp.ids(public.get_member_area_home('@smoke-member-areas') -> 'my_products')
  = array['smoke-ma-b'], 'B is back in the main area');
reset role;

rollback;

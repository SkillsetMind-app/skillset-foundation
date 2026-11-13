\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures desfeitas no rollback final.
--
-- Comunidade da area inteira: o professor escolhe o produto community C como
-- comunidade da area. O aluno so do curso A entra em C (le e posta), sem ganhar
-- matricula em C nem acesso de aula. Quem nao e aluno do professor fica fora.
-- So o dono escolhe, e so um produto community dele.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'AREA_COMMUNITY_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('91113020-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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
  raise exception 'AREA_COMMUNITY_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;

-- 1 professor, 2 aluno so de A, 3 ninguem, 4 outro professor, 5 so pegou o
-- brinde gratis F do professor 1.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'area-community-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 5) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'area-community-%@example.test'
on conflict (uid) do nothing;
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-area-community-plan-' || n, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (4)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);

insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, product_format, community_enabled)
values
  ('smoke-ac-a', pg_temp.uid(1)::text, 'smoke-ac-a', 'Smoke area community A', 'Curso deste smoke.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'course', true),
  ('smoke-ac-c', pg_temp.uid(1)::text, 'smoke-ac-c', 'Smoke area community C', 'Comunidade deste smoke.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'community', true),
  ('smoke-ac-x', pg_temp.uid(4)::text, 'smoke-ac-x', 'Smoke area community X', 'Do outro professor.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'community', true),
  ('smoke-ac-f', pg_temp.uid(1)::text, 'smoke-ac-f', 'Smoke area community F', 'Brinde gratis.', 'smoke',
    'published', 'usd', 0, 'free', '[]'::jsonb, 'course', true),
  ('smoke-ac-d', pg_temp.uid(1)::text, 'smoke-ac-d', 'Smoke area community D', 'Comunidade em rascunho.', 'smoke',
    'draft', 'usd', 0, 'free', '[]'::jsonb, 'community', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
values (pg_temp.uid(2)::text || '__smoke-ac-a', pg_temp.uid(2)::text, 'smoke-ac-a', 'smoke-ac-a',
  'Smoke area community A', 'smoke', '', 'active', 'admin'),
  (pg_temp.uid(5)::text || '__smoke-ac-f', pg_temp.uid(5)::text, 'smoke-ac-f', 'smoke-ac-f',
  'Smoke area community F', 'smoke', '', 'active', 'free_course');
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, body)
values ('smoke-ac-post', 'smoke-ac-c', pg_temp.uid(1)::text, 'Teacher', 'teacher', 'discussion', 'Welcome to the area.');
insert into public.public_profiles(uid, display_name, username)
values (pg_temp.uid(1)::text, 'Area Teacher', 'smoke-area-community');

-- 1) Antes da escolha: o aluno de A nao ve C.
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true(not public.has_community_access('smoke-ac-c'), 'no area community chosen yet');
select pg_temp.assert_true((select count(*) = 0 from public.community_posts where course_slug = 'smoke-ac-c'),
  'posts of C hidden before the choice');
reset role;

-- 2) So o dono escolhe, e so um produto community dele.
select pg_temp.act_as(pg_temp.uid(4));
set local role authenticated;
select pg_temp.refused($$select public.set_my_member_area_community('smoke-ac-c')$$, '22023');
reset role;
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.refused($$select public.set_my_member_area_community('smoke-ac-a')$$, '22023');
select pg_temp.refused($$select public.set_my_member_area_community('smoke-ac-d')$$, '22023');
select public.set_my_member_area_community('smoke-ac-c');
reset role;

-- 3) O aluno de A entra em C: le, posta e ve a comunidade da area. Sem matricula
--    em C: aula, eventos e o resto continuam por matricula.
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true(public.has_community_access('smoke-ac-c'), 'student of A reaches the area community');
select pg_temp.assert_true(not public.has_enrollment_for_course_slug('smoke-ac-c'), 'no enrollment in C is implied');
select pg_temp.assert_true((select count(*) = 1 from public.community_posts where course_slug = 'smoke-ac-c'),
  'student of A reads posts of C');
insert into public.community_posts(course_slug, author_id, author_name, author_role, category, body)
values ('smoke-ac-c', pg_temp.uid(2)::text, 'Student', 'student', 'discussion', 'Hi from course A.');
select pg_temp.assert_true((select public.get_member_area_community('@smoke-area-community') ->> 'course_id') = 'smoke-ac-c',
  'the area home learns its community');
select pg_temp.assert_true(not public.has_community_access('smoke-ac-x'), 'another teacher''s community stays closed');
reset role;

-- 4) Quem nao e aluno do professor fica fora.
select pg_temp.act_as(pg_temp.uid(3));
set local role authenticated;
select pg_temp.assert_true(not public.has_community_access('smoke-ac-c'), 'outsider stays out');
select pg_temp.assert_true((select count(*) = 0 from public.community_posts where course_slug = 'smoke-ac-c'),
  'outsider reads nothing');
select pg_temp.assert_true(public.get_member_area_community('@smoke-area-community') is null, 'outsider gets no community');
reset role;

-- 4b) Brinde gratis nao abre a comunidade da area.
select pg_temp.act_as(pg_temp.uid(5));
set local role authenticated;
select pg_temp.assert_true(not public.has_community_access('smoke-ac-c'), 'a free enrollment does not open the area community');
select pg_temp.assert_true(public.get_member_area_community('@smoke-area-community') is null, 'free-only member gets no community');
reset role;

-- 5) As regras da comunidade usam has_community_access; as de aula e evento nao.
select pg_temp.assert_true((select count(*) = 9 from pg_policies
  where policyname in ('community_posts_select_enrolled','community_posts_insert_enrolled',
    'community_comments_select_enrolled','community_comments_insert_enrolled',
    'community_post_likes_select_enrolled','community_post_likes_insert_owner',
    'community_reports_insert_reporter','community_presence_read','community_presence_write')
    and coalesce(qual, '') || coalesce(with_check, '') like '%has_community_access%'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%has_enrollment_for_course_slug%'),
  'the nine community policies use has_community_access');
select pg_temp.assert_true((select count(*) = 0 from pg_policies
  where tablename in ('courses','course_events','course_event_rsvps')
    and coalesce(qual, '') || coalesce(with_check, '') like '%has_community_access%'),
  'course, event and RSVP rules still need a real enrollment');

rollback;

\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures desfeitas no rollback final.
--
-- Area de membros por criador: o aluno de A ve A em "meus produtos" e B em
-- "mais deste criador", mas nao le nada de B (aula, material, arquivo). A
-- vitrine so devolve campos publicos; rascunho e produto oculto nao aparecem;
-- quem nao e aluno nem dono recebe null; so o dono salva, e so produto dele.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'MEMBER_AREA_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('91016010-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(statement text, state text, expected text default null) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = state and (expected is null or sqlerrm = expected) then return; end if;
    raise;
  end;
  raise exception 'MEMBER_AREA_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;
create function pg_temp.home(p_ref text) returns jsonb language sql as $$
  select public.get_member_area_home(p_ref);
$$;
create function pg_temp.ids(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(x ->> 'course_id' order by n), '{}')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) with ordinality t(x, n);
$$;
create function pg_temp.course(k text) returns text language sql immutable as $$
  select 'smoke-area-' || k;
$$;
create function pg_temp.file_path(k text) returns text language sql immutable as $$
  select 'courses/smoke-area-' || k || '/assets/' || pg_temp.uid(1)::text || '/smoke-area-asset-' || k || '/material.pdf';
$$;

-- 1 criador (Eton), 2 aluno so de A, 3 ninguem, 4 outro criador.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'member-area-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'member-area-%@example.test'
on conflict (uid) do nothing;
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-area-plan-' || n, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (4)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);

-- A (comprado), B (nao comprado), H (publicado, depois oculto), D (rascunho),
-- C (do outro criador). Datas crescentes: o padrao e do mais novo ao mais velho.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, created_at)
select pg_temp.course(k.key), pg_temp.uid(k.owner)::text, pg_temp.course(k.key), 'Smoke area ' || k.key,
  'Curso usado so por este smoke da area de membros.', 'smoke', k.status, 'usd', 0, 'free',
  jsonb_build_array(jsonb_build_object('id', k.key || '-m1', 'title', 'Modulo 1', 'lessons', jsonb_build_array(
    jsonb_build_object('id', k.key || '-1', 'title', 'Aula ' || k.key || ' 1', 'type', 'text'),
    jsonb_build_object('id', k.key || '-2', 'title', 'Aula ' || k.key || ' 2', 'type', 'text')))),
  now() - make_interval(days => k.age)
from (values ('a', 1, 'published', 4), ('b', 1, 'published', 3), ('h', 1, 'published', 2),
  ('d', 1, 'draft', 1), ('c', 4, 'published', 1)) k(key, owner, status, age);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, last_lesson_id)
values (pg_temp.uid(2)::text || '__' || pg_temp.course('a'), pg_temp.uid(2)::text, pg_temp.course('a'),
  pg_temp.course('a'), 'Smoke area a', 'smoke', '', 'active', 'admin', 'a-1');
insert into public.lesson_playback(enrollment_id, lesson_id, user_id, last_seen_at, position_seconds)
values (pg_temp.uid(2)::text || '__' || pg_temp.course('a'), 'a-2', pg_temp.uid(2)::text, now(), 42);
-- O conteudo protegido de B: texto da aula, material e o arquivo no bucket privado.
insert into public.course_lesson_content(lesson_id, course_id, content_text)
values ('b-1', pg_temp.course('b'), 'Texto protegido da aula b-1');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id, created_at)
values ('smoke-area-asset-b', pg_temp.course('b'), pg_temp.uid(1)::text, 'lesson_material',
  'material.pdf', 'application/pdf', 1, pg_temp.file_path('b'), 'b-1', now());
insert into storage.objects(bucket_id, name) values ('course-content', pg_temp.file_path('b'));
-- Perfil publico por ultimo: e-mail de teste nunca ganha perfil pelo gatilho.
insert into public.public_profiles(uid, display_name, username)
values (pg_temp.uid(1)::text, 'Eton Smoke', 'smoke-area-eton');

-- 1) Aluno de A, area virtual: A em meus, B e H na vitrine (mais novo primeiro),
--    rascunho fora, continuar pela ultima aula tocada.
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true(pg_temp.ids(pg_temp.home('@smoke-area-eton') -> 'my_products')
  = array[pg_temp.course('a')], 'student owns only A');
select pg_temp.assert_true(pg_temp.ids(pg_temp.home('@smoke-area-eton') -> 'more_products')
  = array[pg_temp.course('h'), pg_temp.course('b')], 'storefront: published not bought, newest first, no draft');
select pg_temp.assert_true((select d #>> '{area,name}' = 'Eton Smoke' and d #>> '{area,theme}' = 'light'
    and not (d #>> '{area,configured}')::boolean and not (d #>> '{area,is_owner_preview}')::boolean
    and d #>> '{continue,lesson_id}' = 'a-2' and d #>> '{continue,lesson_title}' = 'Aula a 2'
    and (d #>> '{continue,position_seconds}')::int = 42
  from (select pg_temp.home('@smoke-area-eton') as d) x), 'virtual area defaults and continue');
select pg_temp.assert_true((select bool_and((select array_agg(k order by k collate "C") from jsonb_object_keys(p) k(k))
    = array['course_id','cover_image_url','currency','payment_type','price_amount_minor','sales_key','title'])
  from jsonb_array_elements(pg_temp.home('@smoke-area-eton') -> 'more_products') p), 'storefront exposes only public fields');
select pg_temp.assert_true(pg_temp.home('@SMOKE-AREA-ETON') is not null
  and pg_temp.home(pg_temp.uid(1)::text) is not null, 'area resolves by @ in any case and by uid');
select pg_temp.assert_true(pg_temp.home('@ninguem-aqui') is null, 'unknown creator is null');

-- 2) A area nao libera nada de B.
select pg_temp.assert_true(not exists (select 1 from public.course_lesson_content
  where course_id = pg_temp.course('b')), 'student reads lesson text of B');
select pg_temp.assert_true(not exists (select 1 from public.course_assets
  where course_id = pg_temp.course('b')), 'student sees material of B');
select pg_temp.assert_true(not exists (select 1 from storage.objects
  where bucket_id = 'course-content' and name = pg_temp.file_path('b')), 'student opens file of B');
-- Escrita direta na tabela e recusada; nem aluno salva area.
select pg_temp.refused($q$insert into public.member_areas(owner_id) values (pg_temp.uid(2)::text)$q$, '42501');
select pg_temp.refused($q$select public.save_my_member_area('x', 'dark', null, null)$q$, '42501', 'MEMBER_AREA_FORBIDDEN');
select pg_temp.refused($q$select public.save_my_member_area_products('[]')$q$, '42501', 'MEMBER_AREA_FORBIDDEN');
reset role;

-- Controle: o dono le o conteudo de B, entao o "nada" acima e da RLS.
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.assert_true(exists (select 1 from public.course_lesson_content where course_id = pg_temp.course('b'))
  and exists (select 1 from public.course_assets where course_id = pg_temp.course('b'))
  and exists (select 1 from storage.objects where bucket_id = 'course-content' and name = pg_temp.file_path('b')),
  'owner control: B content exists');
reset role;

-- 3) Quem nao e aluno nem dono recebe null; anon nem executa.
select pg_temp.act_as(pg_temp.uid(3));
set local role authenticated;
select pg_temp.assert_true(pg_temp.home('@smoke-area-eton') is null, 'outsider gets null');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
set local role authenticated;
select pg_temp.assert_true(pg_temp.home('@smoke-area-eton') is null, 'other creator gets null');
-- 4) Outro criador nao poe produto do Eton na area dele, e nada e gravado.
select pg_temp.refused(format($q$select public.save_my_member_area_products('[{"course_id": %s}]')$q$,
  to_jsonb(pg_temp.course('a'))), '42501', 'MEMBER_AREA_COURSE_NOT_OWNED');
select pg_temp.refused(format($q$select public.save_my_member_area_products('[{"course_id": %s}, {"course_id": %s}]')$q$,
  to_jsonb(pg_temp.course('c')), to_jsonb(pg_temp.course('b'))), '42501', 'MEMBER_AREA_COURSE_NOT_OWNED');
reset role;
select pg_temp.assert_true(not exists (select 1 from public.member_areas where owner_id = pg_temp.uid(4)::text)
  and not exists (select 1 from public.member_area_products), 'rejected save wrote something');

-- 5) O dono configura: nome, tema, ordem e H oculto. Capa fora da pasta dele e recusada.
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.refused(format($q$select public.save_my_member_area('x', 'light', %L, null)$q$,
  'users/' || pg_temp.uid(4)::text || '/member-area/capa.jpg'), '23514');
select pg_temp.refused(format($q$select public.save_my_member_area('x', 'light', %L, null)$q$,
  'users/' || pg_temp.uid(1)::text || '/member-area/../../' || pg_temp.uid(4)::text || '/x.jpg'), '23514');
select public.save_my_member_area(' Eton Academy ', 'dark',
  'users/' || pg_temp.uid(1)::text || '/member-area/capa.jpg', 'Bem-vindo');
select public.save_my_member_area_products(jsonb_build_array(
  jsonb_build_object('course_id', pg_temp.course('b'), 'visible', true),
  jsonb_build_object('course_id', pg_temp.course('a'), 'visible', true),
  jsonb_build_object('course_id', pg_temp.course('h'), 'visible', false)));
select pg_temp.refused($q$select public.save_my_member_area_products('[{"course_id": "x"}, {"course_id": "x"}]')$q$,
  '22023', 'MEMBER_AREA_ITEMS_INVALID');
-- Previa do dono: nada comprado, vitrine so com o visivel.
select pg_temp.assert_true((select (d #>> '{area,is_owner_preview}')::boolean
    and pg_temp.ids(d -> 'more_products') = array[pg_temp.course('b'), pg_temp.course('a')]
  from (select pg_temp.home('@smoke-area-eton') as d) x), 'owner preview');
reset role;

-- O aluno ve a mudanca: nome, tema, capa, boas-vindas; H oculto some da vitrine.
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true((select d #>> '{area,name}' = 'Eton Academy' and d #>> '{area,theme}' = 'dark'
    and d #>> '{area,welcome_text}' = 'Bem-vindo' and (d #>> '{area,configured}')::boolean
    and d #>> '{area,cover_path}' like 'users/%/member-area/capa.jpg'
    and pg_temp.ids(d -> 'my_products') = array[pg_temp.course('a')]
    and pg_temp.ids(d -> 'more_products') = array[pg_temp.course('b')]
  from (select pg_temp.home('@smoke-area-eton') as d) x), 'student sees saved area, hidden and draft stay out');
select pg_temp.assert_true(not exists (select 1 from public.member_areas)
  and not exists (select 1 from public.member_area_products), 'student reads area tables directly');
reset role;

-- Oculto continua em "meus produtos" para quem comprou.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
values (pg_temp.uid(2)::text || '__' || pg_temp.course('h'), pg_temp.uid(2)::text, pg_temp.course('h'),
  pg_temp.course('h'), 'Smoke area h', 'smoke', '', 'active', 'admin');
select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.assert_true(pg_temp.ids(pg_temp.home('@smoke-area-eton') -> 'my_products')
  = array[pg_temp.course('a'), pg_temp.course('h')], 'hidden product stays in my products');
reset role;

-- anon nao executa a funcao da area.
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.refused($q$select public.get_member_area_home('@smoke-area-eton')$q$, '42501');
reset role;
rollback;

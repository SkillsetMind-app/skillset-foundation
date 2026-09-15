\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- A liberação da aula (drip) vale também no banco. Antes de 20260915020000 só
-- o vídeo respeitava o calendário (rota video-token); o texto, o link e o
-- material de uma aula ainda fechada saíam direto pelo cliente do Supabase para
-- qualquer aluno ativo. Aqui: aluno ativo lê só o que já abriu, dono lê tudo,
-- reembolsado não lê nada além da amostra, a amostra continua pública.
--
-- A segunda metade roda a tabela de src/domain/drip-policy-parity-cases.ts em
-- public.lesson_is_released. O vitest (drip-policy-parity.test.ts) confere que
-- o bloco drip-parity-cases abaixo é exatamente aquela tabela.
begin;
create temp table drip_checks (name text, passed boolean);
grant insert, select on drip_checks to anon, authenticated;
create function pg_temp.check_drip(p_name text, p_ok boolean) returns void
language sql as $$ insert into drip_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('90915020-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Mesmo currículo de dripParityModules: a (0 dias), b (7), p (30, amostra) no
-- módulo 1; c (1) no módulo 2. Os ids levam o prefixo do curso.
create function pg_temp.curriculum(p text) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('id', p || '-m1', 'title', 'Modulo 1', 'lessons', jsonb_build_array(
      jsonb_build_object('title', 'Aula a', 'type', 'text', 'id', p || '-a', 'dripDelayDays', 0),
      jsonb_build_object('title', 'Aula b', 'type', 'text', 'id', p || '-b', 'dripDelayDays', 7),
      jsonb_build_object('title', 'Aula p', 'type', 'text', 'id', p || '-p', 'dripDelayDays', 30))),
    jsonb_build_object('id', p || '-m2', 'title', 'Modulo 2', 'lessons', jsonb_build_array(
      jsonb_build_object('title', 'Aula c', 'type', 'text', 'id', p || '-c', 'dripDelayDays', 1))));
$$;
create function pg_temp.file_path(p_course text, p_asset text) returns text language sql immutable as $$
  select 'courses/smoke-drip-' || p_course || '/assets/' || pg_temp.uid(1)::text
    || '/' || p_course || '-asset-' || p_asset || '/material.pdf';
$$;
-- O que o papel corrente enxerga, pela RLS (funções invoker).
create function pg_temp.lessons_seen(p_course text) returns text[] language sql stable as $$
  select coalesce(array_agg(lesson_id order by lesson_id), '{}')
  from public.course_lesson_content where course_id = 'smoke-drip-' || p_course;
$$;
create function pg_temp.assets_seen(p_course text) returns text[] language sql stable as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.course_assets where course_id = 'smoke-drip-' || p_course;
$$;
create function pg_temp.files_seen(p_course text) returns text[] language sql stable as $$
  select coalesce(array_agg(split_part(name, '/', 5) order by name), '{}')
  from storage.objects
  where bucket_id = 'course-content' and name like 'courses/smoke-drip-' || p_course || '/%';
$$;

-- 1 dono, 2 aluno ativo, 3 aluno reembolsado, 4 aluno da tabela de paridade,
-- 5 ninguém matriculado (a data de entrada falta).
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'drip-release-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 5) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
-- A amostra (free_preview_lesson_id) de todos os cursos é a aula p.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, drip_strategy, drip_interval_days, free_preview_lesson_id)
select 'smoke-drip-' || k.key, pg_temp.uid(1)::text, 'smoke-drip-' || k.key, 'Smoke drip ' || k.key,
  'Curso usado só por este smoke de liberação.', 'smoke', 'published', 'usd', 0, 'free',
  pg_temp.curriculum(k.key), k.strategy, k.interval_days::int, k.key || '-p'
from (values
  ('instant', 'instant', null),
  ('none', null, null),
  ('custom', 'time_drip_custom', null),
  ('sequential', 'sequential_progress', null),
  ('module', 'time_drip_module', 3),
  ('lesson', 'time_drip_lesson', 2)
) k(key, strategy, interval_days);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
select pg_temp.uid(e.n)::text || '__smoke-drip-' || e.course, pg_temp.uid(e.n)::text,
  'smoke-drip-' || e.course, 'smoke-drip-' || e.course, 'Smoke drip', 'smoke', '', e.status, 'admin'
from (values
  (2, 'custom', 'active'), (2, 'sequential', 'active'), (3, 'custom', 'refunded'),
  (4, 'instant', 'active'), (4, 'none', 'active'), (4, 'custom', 'active'),
  (4, 'sequential', 'active'), (4, 'module', 'active'), (4, 'lesson', 'active')
) e(n, course, status);
insert into public.course_lesson_content(lesson_id, course_id, content_text)
select k || '-' || x, 'smoke-drip-' || k, 'Texto protegido da aula ' || x
from unnest(array['custom', 'sequential']) k, unnest(array['a', 'b', 'p', 'c']) x;
-- Material por aula (a, b) e um do curso inteiro (sem aula), com o arquivo.
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id, created_at)
select a.k || '-asset-' || a.x, 'smoke-drip-' || a.k, pg_temp.uid(1)::text, 'lesson_material',
  'material.pdf', 'application/pdf', 1, pg_temp.file_path(a.k, a.x),
  nullif(a.k || '-' || a.x, a.k || '-course'), now()
from (values ('custom', 'a'), ('custom', 'b'), ('custom', 'course'), ('sequential', 'b')) a(k, x);
insert into storage.objects(bucket_id, name)
select 'course-content', storage_path from public.course_assets where course_id like 'smoke-drip-%';

-- Aluno ativo, matriculado hoje, no curso com prazo por aula.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('active student reads the 0-day lesson on enrollment day',
  'custom-a' = any(pg_temp.lessons_seen('custom')));
select pg_temp.check_drip('active student cannot read the 7-day lesson on enrollment day',
  not 'custom-b' = any(pg_temp.lessons_seen('custom')));
select pg_temp.check_drip('active student still reads the free preview lesson',
  'custom-p' = any(pg_temp.lessons_seen('custom')));
select pg_temp.check_drip('active student sees the material of the open lesson',
  'custom-asset-a' = any(pg_temp.assets_seen('custom')));
select pg_temp.check_drip('active student cannot see the material of the closed lesson',
  not 'custom-asset-b' = any(pg_temp.assets_seen('custom')));
select pg_temp.check_drip('active student sees course-level material',
  'custom-asset-course' = any(pg_temp.assets_seen('custom')));
select pg_temp.check_drip('active student opens the file of the open lesson',
  'custom-asset-a' = any(pg_temp.files_seen('custom')));
select pg_temp.check_drip('active student cannot open the file of the closed lesson',
  not 'custom-asset-b' = any(pg_temp.files_seen('custom')));
select pg_temp.check_drip('active student opens the course-level file',
  'custom-asset-course' = any(pg_temp.files_seen('custom')));
reset role;

-- Dono: tudo, qualquer que seja o calendário.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('owner reads every lesson',
  pg_temp.lessons_seen('custom') = array['custom-a', 'custom-b', 'custom-c', 'custom-p']);
select pg_temp.check_drip('owner sees every material',
  pg_temp.assets_seen('custom') = array['custom-asset-a', 'custom-asset-b', 'custom-asset-course']);
select pg_temp.check_drip('owner opens every file',
  pg_temp.files_seen('custom') = array['custom-asset-a', 'custom-asset-b', 'custom-asset-course']);
reset role;

-- Visitante sem sessão: a amostra continua pública, e a leitura não aborta.
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_drip('anonymous visitor still reads the free preview lesson',
  pg_temp.lessons_seen('custom') = array['custom-p']);
reset role;

-- Reembolsado: só a amostra, como já era.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('refunded student reads only the free preview',
  pg_temp.lessons_seen('custom') = array['custom-p']);
select pg_temp.check_drip('refunded student sees no material',
  pg_temp.assets_seen('custom') = '{}');
select pg_temp.check_drip('refunded student opens no file',
  pg_temp.files_seen('custom') = '{}');
reset role;

-- Oito dias depois da matrícula, a aula de 7 dias abre para quem tem direito.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.enrollments set created_at = now() - 8 * interval '24 hours'
  where id in (pg_temp.uid(2)::text || '__smoke-drip-custom', pg_temp.uid(3)::text || '__smoke-drip-custom');
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('active student reads the 7-day lesson on day 8',
  'custom-b' = any(pg_temp.lessons_seen('custom')));
select pg_temp.check_drip('active student sees the material of the 7-day lesson on day 8',
  'custom-asset-b' = any(pg_temp.assets_seen('custom')));
select pg_temp.check_drip('active student opens the file of the 7-day lesson on day 8',
  'custom-asset-b' = any(pg_temp.files_seen('custom')));
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('refunded student still reads only the free preview on day 8',
  pg_temp.lessons_seen('custom') = array['custom-p']);
select pg_temp.check_drip('refunded student still sees no material on day 8',
  pg_temp.assets_seen('custom') = '{}');
reset role;

-- Sequencial: a aula 2 só abre com a aula 1 concluída (linha em lesson_progress).
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('sequential: first lesson is open',
  'sequential-a' = any(pg_temp.lessons_seen('sequential')));
select pg_temp.check_drip('sequential: lesson 2 is closed before lesson 1 is done',
  not 'sequential-b' = any(pg_temp.lessons_seen('sequential')));
select pg_temp.check_drip('sequential: material of lesson 2 is hidden before lesson 1 is done',
  not 'sequential-asset-b' = any(pg_temp.assets_seen('sequential')));
select pg_temp.check_drip('sequential: file of lesson 2 is closed before lesson 1 is done',
  not 'sequential-asset-b' = any(pg_temp.files_seen('sequential')));
reset role;
select pg_temp.act_as(null, 'service_role');
insert into public.lesson_progress(enrollment_id, lesson_id, user_id)
values (pg_temp.uid(2)::text || '__smoke-drip-sequential', 'sequential-a', pg_temp.uid(2)::text);
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_drip('sequential: lesson 2 opens after lesson 1 is done',
  'sequential-b' = any(pg_temp.lessons_seen('sequential')));
select pg_temp.check_drip('sequential: material of lesson 2 appears after lesson 1 is done',
  'sequential-asset-b' = any(pg_temp.assets_seen('sequential')));
select pg_temp.check_drip('sequential: file of lesson 2 opens after lesson 1 is done',
  'sequential-asset-b' = any(pg_temp.files_seen('sequential')));
select pg_temp.check_drip('sequential: lesson 4 stays closed without its previous lesson',
  not 'sequential-c' = any(pg_temp.lessons_seen('sequential')));
reset role;

-- Paridade com o JS: cada caso da tabela em public.lesson_is_released.
-- Sem a função (antes da migration), o caso responde nulo e reprova.
create function pg_temp.released(p_course text, p_lesson text, p_uid text) returns boolean
language plpgsql as $$
declare r boolean;
begin
  if to_regprocedure('public.lesson_is_released(text,text,text)') is null then
    return null;
  end if;
  execute 'select public.lesson_is_released($1, $2, $3)' into r using p_course, p_lesson, p_uid;
  return r;
end $$;
create temp table drip_cases (name text, course text, lesson_id text, days_ago int, completed text[], released boolean);
-- drip-parity-cases:begin
insert into drip_cases values
  ('instant opens a later lesson', 'instant', 'c', 0, '{}', true),
  ('no strategy behaves as instant', 'none', 'c', 0, '{}', true),
  ('the free preview lesson ignores its own delay', 'custom', 'p', 0, '{}', true),
  ('custom: 0-day lesson opens on enrollment day', 'custom', 'a', 0, '{}', true),
  ('custom: 7-day lesson stays closed on enrollment day', 'custom', 'b', 0, '{}', false),
  ('custom: 7-day lesson stays closed on day 6', 'custom', 'b', 6, '{}', false),
  ('custom: 7-day lesson opens on day 7', 'custom', 'b', 7, '{}', true),
  ('sequential: the first lesson is always open', 'sequential', 'a', 0, '{}', true),
  ('sequential: lesson 2 waits for lesson 1', 'sequential', 'b', 0, '{}', false),
  ('sequential: lesson 2 opens after lesson 1', 'sequential', 'b', 0, '{a}', true),
  ('sequential: no cascade past an unfinished lesson', 'sequential', 'c', 0, '{a,b}', false),
  ('sequential: the preview counts as a previous lesson', 'sequential', 'c', 0, '{p}', true),
  ('module: first module opens on enrollment day', 'module', 'b', 0, '{}', true),
  ('module: second module waits one interval', 'module', 'c', 2, '{}', false),
  ('module: second module opens after one interval', 'module', 'c', 3, '{}', true),
  ('lesson: second lesson waits one interval', 'lesson', 'b', 1, '{}', false),
  ('lesson: second lesson opens after one interval', 'lesson', 'b', 2, '{}', true),
  ('lesson: fourth lesson closed one day before', 'lesson', 'c', 5, '{}', false),
  ('lesson: fourth lesson opens after three intervals', 'lesson', 'c', 6, '{}', true),
  ('a lesson missing from the curriculum is not scheduled', 'lesson', 'ghost', 0, '{}', true),
  ('no enrollment date starts the clock now', 'lesson', 'b', null, '{}', false);
-- drip-parity-cases:end
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
do $$
declare
  c record;
  v_enrollment text;
begin
  for c in select * from drip_cases loop
    v_enrollment := pg_temp.uid(4)::text || '__smoke-drip-' || c.course;
    update public.enrollments set created_at = now() - c.days_ago * interval '24 hours'
      where id = v_enrollment and c.days_ago is not null;
    delete from public.lesson_progress where enrollment_id = v_enrollment;
    insert into public.lesson_progress(enrollment_id, lesson_id, user_id)
    select v_enrollment, c.course || '-' || x, pg_temp.uid(4)::text from unnest(c.completed) x;
    perform pg_temp.check_drip('parity: ' || c.name,
      pg_temp.released('smoke-drip-' || c.course, c.course || '-' || c.lesson_id,
        pg_temp.uid(case when c.days_ago is null then 5 else 4 end)::text) = c.released);
  end loop;
end $$;

-- 29 checks de RLS + um por caso da tabela: nenhum pode sumir calado.
select pg_temp.check_drip('every case ran',
  (select count(*) = 29 + (select count(*) from drip_cases) from drip_checks));

select name, passed from drip_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from drip_checks where not passed;
  if failures is not null then
    raise exception 'DRIP_RELEASE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

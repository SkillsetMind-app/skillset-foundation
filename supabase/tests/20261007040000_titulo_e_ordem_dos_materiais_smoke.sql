\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- course_assets ganha title e position (20261007040000). Aqui:
-- - o backfill dá título = nome do arquivo e posição = ordem alfabética de
--   hoje dentro de cada aula, sem tocar no que já tinha valor;
-- - rodar a migration de novo não muda nada (idempotente);
-- - o envio de hoje (sem título nem posição) continua entrando;
-- - o banco recusa título vazio, título comprido e posição negativa;
-- - o dono renomeia e reordena pela própria sessão;
-- - o acesso continua igual: quem não é matriculado não vê linha nem arquivo;
--   o matriculado não vê o material da aula ainda fechada e não renomeia nada.
begin;
create temp table material_checks (name text, passed boolean);
grant insert, select on material_checks to authenticated;
create function pg_temp.check_material(p_name text, p_ok boolean) returns void
language sql as $$ insert into material_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('91007040-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;
create function pg_temp.file_path(p_asset text) returns text language sql immutable as $$
  select 'courses/smoke-materiais/assets/' || pg_temp.uid(1)::text || '/' || p_asset || '/material.pdf';
$$;
-- O que o papel corrente enxerga, pela RLS.
create function pg_temp.assets_seen() returns text[] language sql stable as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.course_assets where course_id = 'smoke-materiais';
$$;
create function pg_temp.files_seen() returns text[] language sql stable as $$
  select coalesce(array_agg(split_part(name, '/', 5) order by name), '{}')
  from storage.objects
  where bucket_id = 'course-content' and name like 'courses/smoke-materiais/%';
$$;

-- 1 dono, 2 aluno ativo (matriculado hoje), 3 ninguém matriculado.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'materiais-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 3) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
-- Aula a abre no dia da matrícula; aula b, 7 dias depois; aula c, também no dia.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, drip_strategy)
values ('smoke-materiais', pg_temp.uid(1)::text, 'smoke-materiais', 'Smoke materiais',
  'Curso usado só por este smoke de materiais.', 'smoke', 'published', 'usd', 0, 'free',
  jsonb_build_array(jsonb_build_object('id', 'smoke-materiais-m1', 'title', 'Modulo 1', 'lessons', jsonb_build_array(
    jsonb_build_object('id', 'sm-a', 'title', 'Aula a', 'type', 'text', 'dripDelayDays', 0),
    jsonb_build_object('id', 'sm-b', 'title', 'Aula b', 'type', 'text', 'dripDelayDays', 7),
    jsonb_build_object('id', 'sm-c', 'title', 'Aula c', 'type', 'text', 'dripDelayDays', 0)))),
  'time_drip_custom');
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
values (pg_temp.uid(2)::text || '__smoke-materiais', pg_temp.uid(2)::text, 'smoke-materiais',
  'smoke-materiais', 'Smoke materiais', 'smoke', '', 'active', 'admin');

-- Linhas "de antes": sem título e sem posição. Na aula a, três arquivos fora
-- de ordem e com maiúscula misturada; um nome só de espaços; na aula b
-- (fechada) um arquivo; na aula c uma linha que já tem título e posição.
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id, title, position, created_at)
select x.id, 'smoke-materiais', pg_temp.uid(1)::text, 'lesson_material', x.file_name,
  'application/pdf', 1, pg_temp.file_path(x.id), x.lesson, x.title, x.position, now()
from (values
  ('sm-zeta', 'Zeta.pdf', 'sm-a', null, null),
  ('sm-alpha', 'alpha.pdf', 'sm-a', null, null),
  ('sm-beta', 'Beta.pdf', 'sm-a', null, null),
  ('sm-blank', '   ', 'sm-a', null, null),
  ('sm-closed', 'notes.pdf', 'sm-b', null, null),
  ('sm-kept', 'kept.pdf', 'sm-c', 'Workbook', 5)
) x(id, file_name, lesson, title, position);
insert into storage.objects(bucket_id, name)
select 'course-content', storage_path from public.course_assets where course_id = 'smoke-materiais';
select set_config('skillset.trusted_write', 'off', true);

-- A migration roda de novo aqui dentro, como roda num banco com linhas antigas.
\ir ../migrations/20261007040000_titulo_e_ordem_dos_materiais.sql

select pg_temp.check_material('backfill: title is the file name',
  (select title from public.course_assets where id = 'sm-zeta') = 'Zeta.pdf'
  and (select title from public.course_assets where id = 'sm-closed') = 'notes.pdf');
select pg_temp.check_material('backfill: a blank file name keeps a null title',
  (select title is null from public.course_assets where id = 'sm-blank'));
-- O nome só de espaços fica fora da comparação: onde ele cai depende da
-- collation do banco.
select pg_temp.check_material('backfill: position follows the old alphabetical order inside the lesson',
  (select array_agg(id order by position) from public.course_assets
    where lesson_id = 'sm-a' and id <> 'sm-blank') = array['sm-alpha', 'sm-beta', 'sm-zeta']
  and (select count(distinct position) = 4 from public.course_assets where lesson_id = 'sm-a'));
select pg_temp.check_material('backfill: positions start at 0 in each lesson',
  (select position from public.course_assets where id = 'sm-closed') = 0
  and (select min(position) from public.course_assets where lesson_id = 'sm-a') = 0);
select pg_temp.check_material('backfill: a row that already had a title and position is untouched',
  (select title = 'Workbook' and position = 5 from public.course_assets where id = 'sm-kept'));

-- Idempotente: a segunda passada não muda nada.
create temp table material_snapshot as
  select id, title, position from public.course_assets where course_id = 'smoke-materiais';
\ir ../migrations/20261007040000_titulo_e_ordem_dos_materiais.sql
select pg_temp.check_material('running the migration again changes nothing',
  not exists (
    (select id, title, position from public.course_assets where course_id = 'smoke-materiais'
     except select * from material_snapshot)
    union all
    (select * from material_snapshot
     except select id, title, position from public.course_assets where course_id = 'smoke-materiais')));

-- O envio de hoje não manda título nem posição, e continua entrando.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
values ('sm-new', 'smoke-materiais', pg_temp.uid(1)::text, 'lesson_material', 'mapa.xmind',
  'application/vnd.xmind.workbook', 1, pg_temp.file_path('sm-new'), 'sm-c');
select pg_temp.check_material('an upload without title or position still goes in',
  (select title is null and position is null from public.course_assets where id = 'sm-new'));

-- O dono renomeia e reordena pela própria sessão (policy de update do dono).
update public.course_assets set title = 'Guia de estudo' where id = 'sm-zeta';
update public.course_assets set position = 0 where id = 'sm-zeta';
update public.course_assets set position = 3 where id = 'sm-blank';
select pg_temp.check_material('the owner renames a file',
  (select title from public.course_assets where id = 'sm-zeta') = 'Guia de estudo');
select pg_temp.check_material('the owner reorders files',
  (select position from public.course_assets where id = 'sm-zeta') = 0
  and (select position from public.course_assets where id = 'sm-blank') = 3);

-- Limites.
select pg_temp.check_material('an empty title is refused',
  pg_temp.refused($q$update public.course_assets set title = '   ' where id = 'sm-alpha'$q$));
select pg_temp.check_material('a title over 180 characters is refused',
  pg_temp.refused(format('update public.course_assets set title = %L where id = %L', repeat('x', 181), 'sm-alpha')));
select pg_temp.check_material('a negative position is refused',
  pg_temp.refused($q$update public.course_assets set position = -1 where id = 'sm-alpha'$q$));
reset role;

-- O acesso não mudou. Sem matrícula: nem a linha nem o arquivo (sem linha não
-- há link assinado; o storage confere a mesma policy ao assinar).
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_material('not enrolled: sees no file row',
  pg_temp.assets_seen() = '{}');
select pg_temp.check_material('not enrolled: opens no stored file',
  pg_temp.files_seen() = '{}');
reset role;

-- Matriculado hoje: a aula a e a c estão abertas, a b ainda não.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_material('enrolled: sees the files of the open lesson',
  'sm-alpha' = any(pg_temp.assets_seen()) and 'sm-zeta' = any(pg_temp.assets_seen()));
select pg_temp.check_material('enrolled: does not see the file of the lesson not released yet',
  not 'sm-closed' = any(pg_temp.assets_seen()));
select pg_temp.check_material('enrolled: opens the stored file of the open lesson',
  'sm-alpha' = any(pg_temp.files_seen()));
select pg_temp.check_material('enrolled: cannot open the stored file of the lesson not released yet',
  not 'sm-closed' = any(pg_temp.files_seen()));
update public.course_assets set title = 'Hacked', position = 0 where id = 'sm-alpha';
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_material('enrolled: cannot rename or reorder',
  (select a.title = 'alpha.pdf' and a.position = s.position
     from public.course_assets a join material_snapshot s using (id) where a.id = 'sm-alpha'));

select pg_temp.check_material('every case ran', (select count(*) = 19 from material_checks));

select name, passed from material_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from material_checks where not passed;
  if failures is not null then
    raise exception 'MATERIAL_TITLE_ORDER_REGRESSION: %', failures;
  end if;
end $$;
rollback;

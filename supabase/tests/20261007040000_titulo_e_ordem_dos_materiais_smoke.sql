\set ON_ERROR_STOP on
-- Disposable database only. Fixtures are undone in the ROLLBACK.
--
-- course_assets gets title and position (20261007040000). Here:
-- - the backfill sets title = file name and position = today's alphabetical order of
--   the files inside each lesson, without touching what already had a value;
-- - running the migration again changes nothing (idempotent);
-- - today's upload (with no title or position) still goes in;
-- - the database refuses an empty title, a long title and a position outside 0..10000,
--   and accepts a title of exactly 180 characters;
-- - the owner renames and reorders from their own session; a teacher of another course cannot;
-- - access stays the same: whoever is not enrolled sees neither row nor file;
--   the enrolled learner does not see the material of a still-closed lesson and renames nothing.
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
-- What the current role sees, through RLS.
create function pg_temp.assets_seen() returns text[] language sql stable as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.course_assets where course_id = 'smoke-materiais';
$$;
create function pg_temp.files_seen() returns text[] language sql stable as $$
  select coalesce(array_agg(split_part(name, '/', 5) order by name), '{}')
  from storage.objects
  where bucket_id = 'course-content' and name like 'courses/smoke-materiais/%';
$$;

-- 1 owner, 2 active learner (enrolled today), 3 nobody enrolled,
-- 4 teacher who owns another course.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'materiais-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);
-- Lesson a opens on the enrollment day; lesson b, 7 days later; lesson c, also on the day.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, drip_strategy)
values ('smoke-materiais', pg_temp.uid(1)::text, 'smoke-materiais', 'Smoke materiais',
  'Curso usado só por este smoke de materiais.', 'smoke', 'published', 'usd', 0, 'free',
  jsonb_build_array(jsonb_build_object('id', 'smoke-materiais-m1', 'title', 'Modulo 1', 'lessons', jsonb_build_array(
    jsonb_build_object('id', 'sm-a', 'title', 'Aula a', 'type', 'text', 'dripDelayDays', 0),
    jsonb_build_object('id', 'sm-b', 'title', 'Aula b', 'type', 'text', 'dripDelayDays', 7),
    jsonb_build_object('id', 'sm-c', 'title', 'Aula c', 'type', 'text', 'dripDelayDays', 0)))),
  'time_drip_custom');
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules)
values ('smoke-materiais-outro', pg_temp.uid(4)::text, 'smoke-materiais-outro', 'Smoke materiais outro',
  'Curso de outro professor, usado só por este smoke.', 'smoke', 'draft', 'usd', 0, 'free', '[]'::jsonb);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
values (pg_temp.uid(2)::text || '__smoke-materiais', pg_temp.uid(2)::text, 'smoke-materiais',
  'smoke-materiais', 'Smoke materiais', 'smoke', '', 'active', 'admin');

-- "Before" rows: no title and no position. In lesson a, three files out
-- of order and with mixed capitalization; a name made only of spaces; in lesson b
-- (closed) one file; in lesson c a row that already has a title and position.
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

-- The migration runs again in here, as it runs on a database with old rows.
\ir ../migrations/20261007040000_titulo_e_ordem_dos_materiais.sql

select pg_temp.check_material('backfill: title is the file name',
  (select title from public.course_assets where id = 'sm-zeta') = 'Zeta.pdf'
  and (select title from public.course_assets where id = 'sm-closed') = 'notes.pdf');
select pg_temp.check_material('backfill: a blank file name keeps a null title',
  (select title is null from public.course_assets where id = 'sm-blank'));
-- The name made only of spaces stays out of the comparison: where it lands depends on the
-- database collation.
select pg_temp.check_material('backfill: position follows the old alphabetical order inside the lesson',
  (select array_agg(id order by position) from public.course_assets
    where lesson_id = 'sm-a' and id <> 'sm-blank') = array['sm-alpha', 'sm-beta', 'sm-zeta']
  and (select count(distinct position) = 4 from public.course_assets where lesson_id = 'sm-a'));
select pg_temp.check_material('backfill: positions start at 0 in each lesson',
  (select position from public.course_assets where id = 'sm-closed') = 0
  and (select min(position) from public.course_assets where lesson_id = 'sm-a') = 0);
select pg_temp.check_material('backfill: a row that already had a title and position is untouched',
  (select title = 'Workbook' and position = 5 from public.course_assets where id = 'sm-kept'));

-- Idempotent: the second pass changes nothing.
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

-- Today's upload sends neither title nor position, and still goes in.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
values ('sm-new', 'smoke-materiais', pg_temp.uid(1)::text, 'lesson_material', 'mapa.xmind',
  'application/vnd.xmind.workbook', 1, pg_temp.file_path('sm-new'), 'sm-c');
select pg_temp.check_material('an upload without title or position still goes in',
  (select title is null and position is null from public.course_assets where id = 'sm-new'));

-- The owner renames and reorders from their own session (the owner's update policy).
update public.course_assets set title = 'Guia de estudo' where id = 'sm-zeta';
update public.course_assets set position = 0 where id = 'sm-zeta';
update public.course_assets set position = 3 where id = 'sm-blank';
select pg_temp.check_material('the owner renames a file',
  (select title from public.course_assets where id = 'sm-zeta') = 'Guia de estudo');
select pg_temp.check_material('the owner reorders files',
  (select position from public.course_assets where id = 'sm-zeta') = 0
  and (select position from public.course_assets where id = 'sm-blank') = 3);

-- Limits.
select pg_temp.check_material('an empty title is refused',
  pg_temp.refused($q$update public.course_assets set title = '   ' where id = 'sm-alpha'$q$));
select pg_temp.check_material('a title over 180 characters is refused',
  pg_temp.refused(format('update public.course_assets set title = %L where id = %L', repeat('x', 181), 'sm-alpha')));
select pg_temp.check_material('a negative position is refused',
  pg_temp.refused($q$update public.course_assets set position = -1 where id = 'sm-alpha'$q$));
select pg_temp.check_material('a position over 10000 is refused',
  pg_temp.refused($q$update public.course_assets set position = 10001 where id = 'sm-alpha'$q$));
update public.course_assets set title = repeat('y', 180), position = 10000 where id = 'sm-beta';
select pg_temp.check_material('a title of exactly 180 characters and position 10000 are accepted',
  (select char_length(title) = 180 and position = 10000 from public.course_assets where id = 'sm-beta'));
reset role;

-- Teacher of another course: the owner's update policy filters the row, nothing changes.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
update public.course_assets set title = 'Outro professor', position = 1 where id = 'sm-beta';
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_material('another teacher cannot rename or reorder',
  (select title = repeat('y', 180) and position = 10000 from public.course_assets where id = 'sm-beta'));

-- Access did not change. Without enrollment: neither the row nor the file (with no row there is
-- no signed link; storage checks the same policy when signing).
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_material('not enrolled: sees no file row',
  pg_temp.assets_seen() = '{}');
select pg_temp.check_material('not enrolled: opens no stored file',
  pg_temp.files_seen() = '{}');
reset role;

-- Enrolled today: lessons a and c are open, b is not yet.
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

select pg_temp.check_material('every case ran', (select count(*) = 22 from material_checks));

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

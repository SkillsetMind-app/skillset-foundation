\set ON_ERROR_STOP on
-- Disposable database only. Fixtures roll back.
--
-- The product type chosen at creation is stored in courses.product_format,
-- and publish_teacher_course asks each type for its own content:
-- - course: a module with a lesson;
-- - community: nothing (lessons are optional);
-- - live_event: a scheduled session in course_events;
-- - ebook: a file (lesson_material) on one of the product's lessons.
-- A lesson that exists still needs content, whatever the type.
begin;
create temp table product_format_checks (name text, passed boolean);
grant insert, select on product_format_checks to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into product_format_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86651007-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(p_sql text, p_message text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then
    if sqlerrm <> p_message then
      raise warning 'unexpected refusal: %', sqlerrm;
    end if;
    return sqlerrm = p_message;
end $$;
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;
create function pg_temp.publish(p_course text) returns text language sql as $$
  select format('select public.publish_teacher_course(%L)', p_course);
$$;
create function pg_temp.create_draft(p_title text, p_format text) returns text language sql as $$
  select public.create_teacher_course_draft(
    p_title, 'Product used only by the product type smoke test.', 'smoke', array['smoke'],
    'free', false, p_format, 'Module 1', 'Lesson 1');
$$;

-- One activated creator.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid(1), 'authenticated', 'authenticated', 'product-format-1@example.test',
  now(), '{}', '{}', now(), now());
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
delete from public.platform_settings where key = 'require_creator_verification';
insert into public.platform_settings(key, value) values ('require_creator_verification', 'false'::jsonb);
select set_config('skillset.trusted_write', 'off', true);

create temp table drafts (format text primary key, id text);
grant insert, select on drafts to authenticated;

-- Creation stores the type. Course and e-book start with Module 1 / Lesson 1;
-- the community starts with its community on.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
insert into drafts
select f, pg_temp.create_draft('Smoke product format ' || f, f)
from unnest(array['course', 'community', 'live_event', 'ebook']) f;
select pg_temp.check_gate('an unknown type is refused',
  pg_temp.refused(
    $q$select pg_temp.create_draft('Smoke product format guided', 'program')$q$,
    'Choose a valid product type.'));
select pg_temp.check_gate('the older six-argument creation still makes a course',
  pg_temp.passed($q$
    insert into drafts select 'legacy', public.create_teacher_course_draft(
      'Smoke product format legacy', 'Product used only by the product type smoke test.',
      'smoke', array['smoke'], 'free', false)
  $q$));
reset role;

select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('each draft stores the chosen type',
  (select array_agg(d.format || '=' || c.product_format order by d.format)
     from drafts d join public.courses c on c.id = d.id)
  = array['community=community', 'course=course', 'ebook=ebook',
          'legacy=course', 'live_event=live_event']);
select pg_temp.check_gate('course starts with Module 1 and Lesson 1',
  (select c.modules->0->>'title' = 'Module 1'
      and c.modules->0->'lessons'->0->>'title' = 'Lesson 1'
      and c.modules->0->'lessons'->0->>'type' = 'video'
      and c.lesson_count = 1
     from drafts d join public.courses c on c.id = d.id where d.format = 'course'));
select pg_temp.check_gate('e-book starts with one download lesson',
  (select jsonb_array_length(c.modules) = 1
      and c.modules->0->'lessons'->0->>'type' = 'download'
     from drafts d join public.courses c on c.id = d.id where d.format = 'ebook'));
select pg_temp.check_gate('community and live event start without lessons',
  (select bool_and(jsonb_array_length(c.modules) = 0 and c.lesson_count = 0)
     from drafts d join public.courses c on c.id = d.id
    where d.format in ('community', 'live_event')));
select pg_temp.check_gate('the community type starts with the community on',
  (select bool_and(c.community_enabled = (d.format = 'community'))
     from drafts d join public.courses c on c.id = d.id));

\set lesson_message 'Add at least one module with a lesson before publishing.'
\set empty_message 'Every lesson needs a video, text or a file before publishing.'
\set session_message 'Schedule the live session before publishing.'
\set file_message 'Upload at least one file before publishing.'

-- Course: an empty starter lesson is not enough, and neither is no lesson.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('course with an empty starter lesson is refused',
  pg_temp.refused(pg_temp.publish((select id from drafts where format = 'course')), :'empty_message'));
reset role;
select pg_temp.act_as(null, 'service_role');
update public.courses set modules = '[]'::jsonb, lesson_count = 0
  where id = (select id from drafts where format = 'legacy');
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('course without lessons is refused',
  pg_temp.refused(pg_temp.publish((select id from drafts where format = 'legacy')), :'lesson_message'));

-- Community: publishes with no lesson at all.
select pg_temp.check_gate('community without lessons publishes',
  pg_temp.passed(pg_temp.publish((select id from drafts where format = 'community'))));

-- Live event: the session is the content.
select pg_temp.check_gate('live event without a session is refused',
  pg_temp.refused(pg_temp.publish((select id from drafts where format = 'live_event')), :'session_message'));
-- Inserted by the owner, as the creation screen does (the link can wait).
insert into public.course_events(id, course_id, course_slug, course_title, owner_id, title,
  description, type, status, starts_at, external_url, recording_asset_id)
select 'smoke-product-format-event', d.id, d.id, 'Smoke product format live_event',
  pg_temp.uid(1)::text, 'Smoke product format live_event', '', 'live_class', 'scheduled',
  (now() + interval '7 days')::text, '', null
from drafts d where d.format = 'live_event';
select pg_temp.check_gate('live event with a scheduled session publishes without lessons',
  pg_temp.passed(pg_temp.publish((select id from drafts where format = 'live_event'))));

-- E-book: the file is the content, and it must sit on a lesson of the product.
select pg_temp.check_gate('e-book without a file is refused',
  pg_temp.refused(pg_temp.publish((select id from drafts where format = 'ebook')), :'file_message'));
reset role;
select pg_temp.act_as(null, 'service_role');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
select 'smoke-product-format-stray', d.id, pg_temp.uid(1)::text, 'lesson_material',
  'stray.pdf', 'application/pdf', 1024, 'courses/' || d.id || '/stray.pdf', 'lesson-not-in-product'
from drafts d where d.format = 'ebook';
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('e-book file outside its lessons is refused',
  pg_temp.refused(pg_temp.publish((select id from drafts where format = 'ebook')), :'file_message'));
reset role;
select pg_temp.act_as(null, 'service_role');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
select 'smoke-product-format-ebook', d.id, pg_temp.uid(1)::text, 'lesson_material',
  'workbook.pdf', 'application/pdf', 1024, 'courses/' || d.id || '/workbook.pdf',
  c.modules->0->'lessons'->0->>'id'
from drafts d join public.courses c on c.id = d.id where d.format = 'ebook';
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('e-book with a file publishes',
  pg_temp.passed(pg_temp.publish((select id from drafts where format = 'ebook'))));
reset role;

-- Optional lessons still need content once they exist.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, product_format, modules)
values ('smoke-product-format-empty-community', pg_temp.uid(1)::text,
  'smoke-product-format-empty-community', 'Smoke product format empty community',
  'Product used only by the product type smoke test.', 'smoke', 'draft', 'USD', 0, 'free',
  'community', jsonb_build_array(jsonb_build_object('id', 'smoke-pf-m1', 'title', 'Module',
    'lessons', jsonb_build_array(jsonb_build_object('id', 'smoke-pf-l1', 'title', 'Lesson', 'type', 'video')))));
select set_config('skillset.trusted_write', 'off', true);
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('community with an empty lesson is refused',
  pg_temp.refused(pg_temp.publish('smoke-product-format-empty-community'), :'empty_message'));
reset role;

-- The column only takes the four types.
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('the column refuses another type',
  pg_temp.refused(
    $q$update public.courses set product_format = 'subscription' where id = 'smoke-product-format-empty-community'$q$,
    'new row for relation "courses" violates check constraint "courses_product_format_check"'));
select pg_temp.check_gate('every case ran', (select count(*) = 17 from product_format_checks));

select name, passed from product_format_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from product_format_checks where not passed;
  if failures is not null then
    raise exception 'PRODUCT_FORMAT_REGRESSION: %', failures;
  end if;
end $$;
rollback;

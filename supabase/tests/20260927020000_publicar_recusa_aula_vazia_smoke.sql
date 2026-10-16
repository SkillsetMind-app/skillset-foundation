\set ON_ERROR_STOP on
-- Disposable database only. Fixtures roll back.
--
-- publish_teacher_course refuses a course while any lesson has nothing for the
-- student to open: no uploaded video or recording, no attached file, no
-- http(s) link, no text and no description. Text and link are saved through
-- the builder, which keeps them in course_lesson_content and strips them from
-- the public modules copy, so the check has to read that table.
begin;
create temp table empty_lesson_checks (name text, passed boolean);
grant insert, select on empty_lesson_checks to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into empty_lesson_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86650927-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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
-- The builder payload the studio sends, with one module and the given lessons.
create function pg_temp.save(p_course text, p_title text, p_lessons jsonb) returns void
language sql as $$
  select public.update_teacher_course_builder(p_course, jsonb_build_object(
    'title', p_title,
    'summary', 'Course used only by the empty lesson smoke test.',
    'categories', jsonb_build_array('smoke'),
    'paymentType', 'free',
    'currency', 'USD',
    'modules', jsonb_build_array(jsonb_build_object(
      'id', p_course || '-m1', 'title', 'Module', 'lessons', p_lessons))
  ));
$$;

-- One activated creator with free drafts, each with lessons that start empty.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid(1), 'authenticated', 'authenticated', 'empty-lesson-1@example.test',
  now(), '{}', '{}', now(), now());
-- This smoke isolates activation/content; creator plans are already current.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from generate_series(1, 1) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
delete from public.platform_settings where key = 'require_creator_verification';
insert into public.platform_settings(key, value) values ('require_creator_verification', 'false'::jsonb);
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules)
select 'smoke-empty-lesson-' || k, pg_temp.uid(1)::text, 'smoke-empty-lesson-' || k,
  'Smoke empty lesson ' || k, 'Course used only by the empty lesson smoke test.', 'smoke', 'draft',
  'USD', 0, 'free',
  jsonb_build_array(jsonb_build_object('id', 'smoke-empty-lesson-' || k || '-m1', 'title', 'Module',
    'lessons', case when k = 'mixed'
      then jsonb_build_array(
        jsonb_build_object('id', 'smoke-empty-lesson-mixed-l1', 'title', 'Filled', 'type', 'text',
          'description', 'This lesson has a description.'),
        jsonb_build_object('id', 'smoke-empty-lesson-mixed-l2', 'title', 'Empty', 'type', 'video'))
      else jsonb_build_array(
        jsonb_build_object('id', 'smoke-empty-lesson-' || k || '-l1', 'title', 'Lesson', 'type', 'video'))
    end))
from unnest(array['text', 'link', 'video', 'file', 'mixed']) k;
select set_config('skillset.trusted_write', 'off', true);

\set empty_message 'Every lesson needs a video, text or a file before publishing.'

-- Text: empty, then whitespace only, then real text, all saved by the owner.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('lesson without anything is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-text'), :'empty_message'));
select pg_temp.save('smoke-empty-lesson-text', 'Smoke empty lesson text', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-text-l1', 'title', 'Lesson', 'type', 'text',
    'contentText', E'  \n\t ')));
select pg_temp.check_gate('whitespace-only text is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-text'), :'empty_message'));
select pg_temp.save('smoke-empty-lesson-text', 'Smoke empty lesson text', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-text-l1', 'title', 'Lesson', 'type', 'text',
    'contentText', 'The lesson text the student reads.')));
select pg_temp.check_gate('text saved by the builder publishes',
  pg_temp.passed(pg_temp.publish('smoke-empty-lesson-text')));

-- Link: something that is not an http(s) URL does not count; a video link does.
select pg_temp.save('smoke-empty-lesson-link', 'Smoke empty lesson link', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-link-l1', 'title', 'Lesson', 'type', 'video',
    'externalUrl', 'javascript:alert(1)')));
select pg_temp.check_gate('non-http link is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-link'), :'empty_message'));
-- The whole value has to be a URL, not just start like one: new URL() in the
-- player rejects both of these, so the student would get no video and no link.
select pg_temp.save('smoke-empty-lesson-link', 'Smoke empty lesson link', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-link-l1', 'title', 'Lesson', 'type', 'video',
    'externalUrl', 'https://%')));
select pg_temp.check_gate('link with an invalid host is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-link'), :'empty_message'));
select pg_temp.save('smoke-empty-lesson-link', 'Smoke empty lesson link', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-link-l1', 'title', 'Lesson', 'type', 'video',
    'externalUrl', 'https://www.you tube.com/watch')));
select pg_temp.check_gate('link with a space in the host is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-link'), :'empty_message'));
select pg_temp.save('smoke-empty-lesson-link', 'Smoke empty lesson link', jsonb_build_array(
  jsonb_build_object('id', 'smoke-empty-lesson-link-l1', 'title', 'Lesson', 'type', 'video',
    'externalUrl', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')));
select pg_temp.check_gate('video link publishes',
  pg_temp.passed(pg_temp.publish('smoke-empty-lesson-link')));

-- Mixed: one filled lesson does not cover an empty one.
select pg_temp.check_gate('one empty lesson among filled ones is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-mixed'), :'empty_message'));

-- Uploaded video and attached file are course_assets rows.
select pg_temp.check_gate('lesson waiting for its video is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-video'), :'empty_message'));
reset role;
select pg_temp.act_as(null, 'service_role');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
values
  ('smoke-empty-lesson-video-a1', 'smoke-empty-lesson-video', pg_temp.uid(1)::text, 'lesson_video',
    'lesson.mp4', 'video/mp4', 1024, 'courses/smoke-empty-lesson-video/lesson.mp4',
    'smoke-empty-lesson-video-l1'),
  ('smoke-empty-lesson-file-a1', 'smoke-empty-lesson-file', pg_temp.uid(1)::text, 'lesson_thumbnail',
    'thumb.png', 'image/png', 1024, 'courses/smoke-empty-lesson-file/thumb.png',
    'smoke-empty-lesson-file-l1');
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('uploaded video publishes',
  pg_temp.passed(pg_temp.publish('smoke-empty-lesson-video')));
select pg_temp.check_gate('a thumbnail alone is refused',
  pg_temp.refused(pg_temp.publish('smoke-empty-lesson-file'), :'empty_message'));
reset role;
select pg_temp.act_as(null, 'service_role');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, lesson_id)
values ('smoke-empty-lesson-file-a2', 'smoke-empty-lesson-file', pg_temp.uid(1)::text, 'lesson_material',
  'workbook.pdf', 'application/pdf', 1024, 'courses/smoke-empty-lesson-file/workbook.pdf',
  'smoke-empty-lesson-file-l1');
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('attached file publishes',
  pg_temp.passed(pg_temp.publish('smoke-empty-lesson-file')));
reset role;

-- What passed is published; what was refused is not.
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('published exactly the text, link, video and file courses',
  (select array_agg(id order by id) from public.courses
    where id like 'smoke-empty-lesson-%' and status = 'published')
  = array['smoke-empty-lesson-file', 'smoke-empty-lesson-link',
          'smoke-empty-lesson-text', 'smoke-empty-lesson-video']);
select pg_temp.check_gate('text was read from the private table, not the public row',
  not exists (
    select 1
    from public.courses c,
         jsonb_array_elements(c.modules) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where c.id = 'smoke-empty-lesson-text' and l ? 'contentText'));
select pg_temp.check_gate('every case ran', (select count(*) = 14 from empty_lesson_checks));

select name, passed from empty_lesson_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from empty_lesson_checks where not passed;
  if failures is not null then
    raise exception 'EMPTY_LESSON_REGRESSION: %', failures;
  end if;
end $$;
rollback;

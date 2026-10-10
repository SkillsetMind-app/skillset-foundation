\set ON_ERROR_STOP on
-- Disposable database only. Fixtures roll back.
--
-- 20261007020000: what the product type still needed after 20261007010000.
--   1. product_format is frozen: the owner cannot PATCH it; service_role can.
--   2. issue_skillset_certificate refuses an e-book, even at 1 of 1 lessons.
--   3. submit_course_review skips the 50% rule without a lesson track (another
--      type, or a course with no lesson); a course with lessons keeps it.
--   4. A live-event session has to start in the future (owner insert); other
--      types still take a past session, and service_role passes.
--   5. get_live_event_session gives a visitor the next session date and the
--      creator's time zone, only for a published live event.
begin;
create temp table travas_checks (name text, passed boolean);
grant insert, select on travas_checks to authenticated, anon;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into travas_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select (lpad(n::text, 8, '0') || '-1007-4020-8000-000000000000')::uuid;
$$;
-- The id submit_course_review looks up: <uid>__<course>.
create function pg_temp.enr(n int, p_course text) returns text language sql immutable as $$
  select pg_temp.uid(n)::text || '__' || p_course;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true only when the call fails with a message LIKE p_like. Success counts as
-- a failure and is undone.
create function pg_temp.refused(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then
    if sqlerrm not like p_like then
      raise warning 'unexpected refusal: %', sqlerrm;
    end if;
    return sqlerrm like p_like;
end $$;
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;
create function pg_temp.lessons(p text, n int) returns jsonb language sql immutable as $$
  select case when n = 0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'id', p || '-m1', 'title', 'Module 1', 'lessons',
    (select jsonb_agg(jsonb_build_object('id', p || '-' || i, 'title', 'Lesson ' || i, 'type', 'text'))
       from generate_series(1, n) i))) end;
$$;
create function pg_temp.session_at(p_course text, p_id text, p_at interval) returns text language sql as $$
  select format(
    $f$insert into public.course_events(id, course_id, course_slug, course_title, owner_id, title,
         description, type, status, starts_at, external_url, recording_asset_id)
       values (%L, %L, %L, 'Smoke travas', %L, 'Smoke travas', '', 'live_class', 'scheduled', %L,
         'https://meet.example.test/smoke', null)$f$,
    p_id, p_course, p_course, pg_temp.uid(1)::text,
    to_char((now() + p_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;

-- 1 creator (time zone set), 2 student.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'travas-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 2) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now(), timezone = 'America/Sao_Paulo'
  where uid = pg_temp.uid(1)::text;
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, product_format, community_enabled, modules, lesson_count)
select 'smoke-travas-' || k.key, pg_temp.uid(1)::text, 'smoke-travas-' || k.key, 'Smoke travas ' || k.key,
  'Product used only by the product type locks smoke test.', 'smoke', k.status, 'usd', 0, 'free',
  k.format, k.format = 'community', pg_temp.lessons('smoke-travas-' || k.key, k.n), k.n
from (values
  ('draft', 'course', 'draft', 1),
  ('course', 'course', 'published', 1),
  ('empty', 'course', 'published', 0),
  ('community', 'community', 'published', 0),
  ('ebook', 'ebook', 'published', 1),
  ('live', 'live_event', 'published', 0),
  ('live-draft', 'live_event', 'draft', 0)
) k(key, format, status, n);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
select pg_temp.enr(2, 'smoke-travas-' || c), pg_temp.uid(2)::text, 'smoke-travas-' || c,
  'smoke-travas-' || c, 'Smoke travas', 'smoke', '', 'active', 'admin'
from unnest(array['course', 'empty', 'community', 'ebook']) c;
-- The student opened every lesson of the course and of the e-book.
insert into public.lesson_progress(enrollment_id, lesson_id, user_id)
select pg_temp.enr(2, 'smoke-travas-' || c), 'smoke-travas-' || c || '-1', pg_temp.uid(2)::text
from unnest(array['course', 'ebook']) c;
select set_config('skillset.trusted_write', 'off', true);

-- 1. product_format is frozen.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('freeze: the owner cannot PATCH product_format on a draft',
  pg_temp.refused(
    $q$update public.courses set product_format = 'ebook' where id = 'smoke-travas-draft'$q$,
    'courses: product_format is set at creation (admin/ops/service only)'));
select pg_temp.check_gate('freeze: the owner cannot PATCH product_format after publish',
  pg_temp.refused(
    $q$update public.courses set product_format = 'ebook' where id = 'smoke-travas-course'$q$,
    'courses: product_format is set at creation (admin/ops/service only)'));
select pg_temp.check_gate('freeze: the owner still edits the rest of the draft',
  pg_temp.passed($q$update public.courses set title = 'Smoke travas renamed' where id = 'smoke-travas-draft'$q$));
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('freeze: service_role still changes the type',
  pg_temp.passed($q$update public.courses set product_format = 'community' where id = 'smoke-travas-draft'$q$));
select pg_temp.check_gate('freeze: the type changed only through service_role',
  (select product_format = 'community' and title = 'Smoke travas renamed'
     from public.courses where id = 'smoke-travas-draft'));

-- 2. E-book: no certificate, even at 1 of 1.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('certificate: an e-book at 1 of 1 lessons is refused',
  pg_temp.refused(
    $q$select public.issue_skillset_certificate(pg_temp.enr(2, 'smoke-travas-ebook'), 'Smoke Learner')$q$,
    'E-books do not issue certificates.'));
select pg_temp.check_gate('certificate: a course at 1 of 1 lessons is still issued',
  public.issue_skillset_certificate(pg_temp.enr(2, 'smoke-travas-course'), 'Smoke Learner')
    = pg_temp.enr(2, 'smoke-travas-course'));

-- 3. Reviews without a lesson track skip the 50% rule.
select pg_temp.check_gate('review: a community with no lessons is reviewed at 0%',
  pg_temp.passed($q$select public.submit_course_review('smoke-travas-community', 5, 'Great community')$q$));
select pg_temp.check_gate('review: an e-book is reviewed without progress',
  pg_temp.passed($q$select public.submit_course_review('smoke-travas-ebook', 4, null)$q$));
select pg_temp.check_gate('review: a course with no lessons is reviewed at 0%',
  pg_temp.passed($q$select public.submit_course_review('smoke-travas-empty', 4, null)$q$));
reset role;
-- The course with a lesson: progress back to 0, as if the lesson was un-marked.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.enrollments set progress_percent = 0 where id = pg_temp.enr(2, 'smoke-travas-course');
select set_config('skillset.trusted_write', 'off', true);
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('review: a course with lessons still needs 50%',
  pg_temp.refused($q$select public.submit_course_review('smoke-travas-course', 5, null)$q$,
    'Complete at least 50% of the course before leaving a review.'));
reset role;

-- 4. A live-event session starts in the future.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('session: the owner cannot add a past session to a live event',
  pg_temp.refused(pg_temp.session_at('smoke-travas-live-draft', 'smoke-travas-past', interval '-1 hour'),
    'The live session must start in the future.'));
select pg_temp.check_gate('session: the owner adds a future session to a live event',
  pg_temp.passed(pg_temp.session_at('smoke-travas-live-draft', 'smoke-travas-next', interval '7 days')));
select pg_temp.check_gate('session: a course still takes a past session (the Agenda keeps a record)',
  pg_temp.passed(pg_temp.session_at('smoke-travas-course', 'smoke-travas-course-past', interval '-1 day')));
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('session: service_role still writes a past live-event session',
  pg_temp.passed(pg_temp.session_at('smoke-travas-live', 'smoke-travas-live-past', interval '-2 days')));
select pg_temp.check_gate('session: service_role writes the next session of the published event',
  pg_temp.passed(pg_temp.session_at('smoke-travas-live', 'smoke-travas-live-next', interval '3 days'))
  and pg_temp.passed(pg_temp.session_at('smoke-travas-live', 'smoke-travas-live-later', interval '9 days')));
select pg_temp.check_gate('session: the future session from the owner was written',
  exists (select 1 from public.course_events where id = 'smoke-travas-next'));

-- 5. The sales page reads the session date and the creator's time zone.
-- (Read the expected date first: a visitor cannot read course_events.)
select starts_at as next_at from public.course_events where id = 'smoke-travas-live-next' \gset
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_gate('sales page: a visitor gets the next session and the time zone',
  (select count(*) = 1
      and min(s.starts_at) = :'next_at'
      and min(s.timezone) = 'America/Sao_Paulo'
     from public.get_live_event_session('smoke-travas-live') s));
select pg_temp.check_gate('sales page: a draft live event gives nothing',
  not exists (select 1 from public.get_live_event_session('smoke-travas-live-draft')));
select pg_temp.check_gate('sales page: another type gives nothing',
  not exists (select 1 from public.get_live_event_session('smoke-travas-course')));
reset role;
select pg_temp.act_as(null, 'service_role');
-- Once every session passed, the page shows the last real date.
delete from public.course_events where id in ('smoke-travas-live-next', 'smoke-travas-live-later');
select pg_temp.check_gate('sales page: with no session ahead, the last one',
  (select s.starts_at = (select starts_at from public.course_events where id = 'smoke-travas-live-past')
     from public.get_live_event_session('smoke-travas-live') s));
select pg_temp.check_gate('sales page: only the date and the time zone, never the link',
  (select proargnames = array['p_course_id', 'starts_at', 'timezone']
     from pg_proc where oid = 'public.get_live_event_session(text)'::regprocedure));
select pg_temp.check_gate('sales page: anon and authenticated execute it',
  has_function_privilege('anon', 'public.get_live_event_session(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_live_event_session(text)', 'EXECUTE'));

select pg_temp.check_gate('every case ran', (select count(*) = 23 from travas_checks));

select name, passed from travas_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from travas_checks where not passed;
  if failures is not null then
    raise exception 'PRODUCT_FORMAT_LOCKS_REGRESSION: %', failures;
  end if;
end $$;
rollback;

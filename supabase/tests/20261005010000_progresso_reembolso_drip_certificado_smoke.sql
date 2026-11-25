\set ON_ERROR_STOP on
-- Disposable database only. Fixtures go back on ROLLBACK.
--
-- 20261005010000: learner progress can no longer be bypassed.
--   1. Refund: unchecking lessons lowers progress_percent, but not the peak
--      (max_progress_percent), and the learner does not write the peak directly.
--   2. Drip: record_lesson_progress refuses to complete a still-closed lesson (in
--      sequential mode and in per-lesson deadline mode), and unchecking the previous one closes it again.
--   3. Certificate: completion is measured against the CURRENT curriculum. A lesson
--      added after 'completed' holds back issuance; a removed lesson
--      stops holding it back.
--   4. 199 of 200 lessons is 99%, not 100% complete.
--   5. The teacher's message notifies the learner with the link to the messages tab.
--   6. submit_course_review locks the course before reading the sum of the ratings
--      (checked in the catalog: real concurrency needs two connections).
begin;
create temp table progress_checks (name text, passed boolean);
grant insert, select on progress_checks to authenticated;
create function pg_temp.check_progress(p_name text, p_ok boolean) returns void
language sql as $$ insert into progress_checks values (p_name, coalesce(p_ok, false)); $$;
-- The number goes at the START: the certificate code uses the first 18
-- characters of the enrollment plus the millisecond, and inside a transaction the
-- millisecond is the same. With the number at the end, two learners collided.
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select (lpad(n::text, 8, '0') || '-1005-4010-8000-000000000000')::uuid;
$$;
create function pg_temp.enr(n int, p_course text) returns text language sql immutable as $$
  select pg_temp.uid(n)::text || '__smoke-prog-' || p_course;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true only when the call fails with a message that matches p_like. Success
-- counts as a failure and is undone.
create function pg_temp.refused(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm like p_like;
end $$;
-- One module; ids with the course prefix; optional delay per lesson.
create function pg_temp.curriculum(p text, ids text[], delays int[]) returns jsonb
language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('id', p || '-m1', 'title', 'Modulo 1', 'lessons',
    (select jsonb_agg(jsonb_build_object('title', 'Aula ' || u.x, 'type', 'text', 'id', p || '-' || u.x,
        'dripDelayDays', coalesce(delays[u.o::int], 0)) order by u.o)
       from unnest(ids) with ordinality u(x, o))));
$$;

-- 1 owner, 2 learner, 3 learner of the 200-lesson course and of the shrinking course.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'progress-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 3) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules, drip_strategy)
select 'smoke-prog-' || k.key, pg_temp.uid(1)::text, 'smoke-prog-' || k.key, 'Smoke progress ' || k.key,
  'Curso usado só por este smoke de progresso.', 'smoke', 'published', 'usd', 0, 'free',
  pg_temp.curriculum(k.key, k.ids, k.delays), k.strategy
from (values
  ('seq', array['a', 'b', 'c'], null::int[], 'sequential_progress'),
  ('custom', array['a', 'b'], array[0, 7], 'time_drip_custom'),
  ('cert', array['a', 'b'], null::int[], 'instant'),
  ('shrink', array['a', 'b', 'c'], null::int[], 'instant'),
  ('big', array(select n::text from generate_series(1, 200) n), null::int[], 'instant')
) k(key, ids, delays, strategy);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
select pg_temp.enr(e.n, e.course), pg_temp.uid(e.n)::text, 'smoke-prog-' || e.course,
  'smoke-prog-' || e.course, 'Smoke progress', 'smoke', '', 'active', 'admin'
from (values (2, 'seq'), (2, 'custom'), (2, 'cert'), (3, 'shrink'), (3, 'big')) e(n, course);

-- 2. Drip: a closed lesson is not completed.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('drip: sequential lesson 2 cannot be marked before lesson 1',
  pg_temp.refused($q$select public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-b', true)$q$,
    '%not released%'));
select pg_temp.check_progress('drip: sequential lesson 3 cannot be marked on day 1 either',
  pg_temp.refused($q$select public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-c', true)$q$,
    '%not released%'));
select pg_temp.check_progress('drip: a 7-day lesson cannot be marked on enrollment day',
  pg_temp.refused($q$select public.record_lesson_progress(pg_temp.enr(2, 'custom'), 'custom-b', true)$q$,
    '%not released%'));
select pg_temp.check_progress('drip: an open lesson is still marked',
  (public.record_lesson_progress(pg_temp.enr(2, 'custom'), 'custom-a', true) ->> 'completedLessonCount')::int = 1);
select pg_temp.check_progress('drip: sequential lesson 1 is marked',
  (public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-a', true) ->> 'progressPercent')::int = 33);
select pg_temp.check_progress('drip: sequential lesson 2 opens once lesson 1 is done',
  (public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-b', true) ->> 'progressPercent')::int = 67);

-- 1. Refund: unchecking lowers progress, not the peak.
select pg_temp.check_progress('refund: un-marking lesson 2 lowers progress',
  (public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-b', false) ->> 'progressPercent')::int = 33);
select pg_temp.check_progress('refund: un-marking lesson 1 lowers progress to zero',
  (public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-a', false) ->> 'progressPercent')::int = 0);
select pg_temp.check_progress('drip: lesson 2 locks again once lesson 1 is un-marked',
  pg_temp.refused($q$select public.record_lesson_progress(pg_temp.enr(2, 'seq'), 'seq-b', true)$q$,
    '%not released%'));
-- The attack through PostgREST: the learner tries to zero their own peak.
select pg_temp.check_progress('refund: the student cannot lower the own peak through RLS',
  pg_temp.refused($q$update public.enrollments set max_progress_percent = 0 where id = pg_temp.enr(2, 'seq')$q$,
    'enrollments: owners may only update last_lesson_id and updated_at'));
reset role;
select pg_temp.check_progress('refund: progress_percent follows the un-marking',
  (select progress_percent = 0 from public.enrollments where id = pg_temp.enr(2, 'seq')));
select pg_temp.check_progress('refund: max_progress_percent keeps the peak',
  (select max_progress_percent = 67 from public.enrollments where id = pg_temp.enr(2, 'seq')));

-- 4. Rounding: 199 of 200 does not complete.
select pg_temp.act_as(null, 'service_role');
insert into public.lesson_progress(enrollment_id, lesson_id, user_id)
select pg_temp.enr(3, 'big'), 'big-' || n, pg_temp.uid(3)::text from generate_series(1, 198) n;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('rounding: 199 of 200 lessons is 99% and still active',
  public.record_lesson_progress(pg_temp.enr(3, 'big'), 'big-199', true)
    @> '{"progressPercent": 99, "status": "active"}');
select pg_temp.check_progress('rounding: the last lesson completes the course',
  public.record_lesson_progress(pg_temp.enr(3, 'big'), 'big-200', true)
    @> '{"progressPercent": 100, "status": "completed"}');
reset role;

-- 3. Certificate against the current curriculum.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('certificate: lesson a of the certificate course is marked',
  (public.record_lesson_progress(pg_temp.enr(2, 'cert'), 'cert-a', true) ->> 'progressPercent')::int = 50);
select pg_temp.check_progress('certificate: the certificate course is completed',
  public.record_lesson_progress(pg_temp.enr(2, 'cert'), 'cert-b', true) @> '{"status": "completed"}');
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('certificate: lessons a and b of the shrinking course are marked',
  (public.record_lesson_progress(pg_temp.enr(3, 'shrink'), 'shrink-a', true) ->> 'progressPercent')::int = 33);
select pg_temp.check_progress('certificate: the shrinking course is at 67%',
  (public.record_lesson_progress(pg_temp.enr(3, 'shrink'), 'shrink-b', true) ->> 'progressPercent')::int = 67);
reset role;
-- The teacher adds a lesson to one course and removes one from the other.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.courses set modules = pg_temp.curriculum('cert', array['a', 'b', 'c'], null)
  where id = 'smoke-prog-cert';
update public.courses set modules = pg_temp.curriculum('shrink', array['a', 'b'], null)
  where id = 'smoke-prog-shrink';
select pg_temp.check_progress('certificate: the stored status is stale on purpose',
  (select status = 'completed' and progress_percent = 100
     from public.enrollments where id = pg_temp.enr(2, 'cert'))
  and (select status = 'active' and progress_percent = 67
     from public.enrollments where id = pg_temp.enr(3, 'shrink')));
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('certificate: a removed lesson no longer holds back issuance',
  public.issue_skillset_certificate(pg_temp.enr(3, 'shrink'), 'Smoke Learner') = pg_temp.enr(3, 'shrink'));
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('certificate: a lesson added after completion blocks issuance',
  pg_temp.refused($q$select public.issue_skillset_certificate(pg_temp.enr(2, 'cert'), 'Smoke Learner')$q$,
    'Complete the course%'));
select pg_temp.check_progress('certificate: the new lesson is marked',
  public.record_lesson_progress(pg_temp.enr(2, 'cert'), 'cert-c', true) @> '{"status": "completed"}');
select pg_temp.check_progress('certificate: issued once every current lesson is done',
  public.issue_skillset_certificate(pg_temp.enr(2, 'cert'), 'Smoke Learner') = pg_temp.enr(2, 'cert'));
reset role;
select pg_temp.check_progress('certificate: both certificates exist as issued',
  (select count(*) = 2 from public.certificates
    where id in (pg_temp.enr(2, 'cert'), pg_temp.enr(3, 'shrink')) and status = 'issued'));

-- 5. Teacher message: link to the course messages tab.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_progress('message: the teacher message is sent',
  (public.send_course_message('smoke-prog-cert', pg_temp.uid(2)::text, 'Smoke hello') ->> 'success')::boolean);
reset role;
select pg_temp.check_progress('message: the student notification opens the course messages tab',
  exists (select 1 from public.notifications
    where user_id = pg_temp.uid(2)::text and type = 'course_message'
      and link = '/learn/courses/smoke-prog-cert/messages'));

-- 6. Review: the course is locked before the sum is read.
select pg_temp.check_progress('review: the course row is locked before the rating sum is read',
  (select prosrc ~* 'from public[.]courses[[:space:]]+where id = v_course_id[[:space:]]+for update;'
      and position('for update;' in prosrc) < position('v_current_sum :=' in prosrc)
     from pg_proc where oid = 'public.submit_course_review(text,integer,text)'::regprocedure));

-- The grants did not change: authenticated executes, anon does not.
select pg_temp.check_progress('grants: authenticated keeps EXECUTE and anon stays out',
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
       and not has_function_privilege('anon', f, 'EXECUTE'))
     from unnest(array[
       'public.record_lesson_progress(text,text,boolean)',
       'public.issue_skillset_certificate(text,text)',
       'public.send_course_message(text,text,text)',
       'public.submit_course_review(text,integer,text)'
     ]) f));

select pg_temp.check_progress('every check ran',
  (select count(*) = 28 from progress_checks));

select name, passed from progress_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from progress_checks where not passed;
  if failures is not null then
    raise exception 'PROGRESS_REGRESSION: %', failures;
  end if;
end $$;
rollback;

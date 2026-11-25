\set ON_ERROR_STOP on

-- Proves, against a real database, what migration 20260903120000 promises:
-- opening the lesson is recorded, the video position lives in the database (and not in the
-- browser), the row is one per (enrollment, lesson), and neither another learner nor the
-- teacher can read anyone's raw row.
--
-- Safe against a live database: the two learners, the second course and the enrollments
-- are born and die inside this transaction, undone by the ROLLBACK at the end.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition boolean,
  p_message text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', p_message;
  END IF;
END;
$$;

-- Expected refusal. The EXCEPTION block opens a subtransaction: the error knocks down only
-- the attempt, not this whole transaction.
CREATE OR REPLACE FUNCTION pg_temp.assert_refused(
  p_sql text,
  p_message text,
  p_expected_sqlstate text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    IF p_expected_sqlstate IS NOT NULL AND SQLSTATE <> p_expected_sqlstate THEN
      RAISE;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', p_message;
END;
$$;

-- ---------------------------------------------------------------------------
-- 0. Scenario: a teacher (the seed user, owner of smoke-ci-course) and two
--    different learners of that teacher.
-- ---------------------------------------------------------------------------

-- Lessons in the seed course: the function refuses a lesson that is not in `modules`.
UPDATE public.courses
SET modules = '[{"id":"m1","lessons":[{"id":"lesson-1"},{"id":"lesson-2"}]}]'::jsonb
WHERE id = 'smoke-ci-course';

-- A second course, from the same teacher, with a lesson that does NOT belong to
-- the enrollment below -- it is the case "recording on a lesson of another course".
INSERT INTO public.courses (
  id, owner_id, slug, title, summary, category, status,
  currency, price_amount_minor, modules
) VALUES (
  'smoke-playback-other', '11111111-1111-4111-8111-111111111111',
  'smoke-playback-other', 'Other course', 'Smoke', 'smoke', 'published',
  'brl', 0, '[{"id":"m1","lessons":[{"id":"lesson-of-other-course"}]}]'::jsonb
);

-- The two learners. public.users is born from the on_auth_user_created trigger, the
-- same path as a real signup.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'learner-a@smoke.local', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'learner-b@smoke.local', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

INSERT INTO public.enrollments (
  id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, progress_percent, created_at, updated_at
) VALUES
  ('smoke-pb-a', '22222222-2222-4222-8222-222222222222', 'smoke-ci-course',
   'smoke-ci-course', 'Smoke CI', 'smoke', '', 'active', 'admin', 0, now(), now()),
  ('smoke-pb-b', '33333333-3333-4333-8333-333333333333', 'smoke-ci-course',
   'smoke-ci-course', 'Smoke CI', 'smoke', '', 'active', 'admin', 0, now(), now());

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text,
    true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Opening the lesson already leaves a trace -- until now only completion left one
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;

SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 1,
  'opening a lesson must create the funnel row'
);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 0,
  'opening without a position starts at zero'
);

-- ---------------------------------------------------------------------------
-- 2. The position goes up, the row stays ONE, and opened_at does not move
-- ---------------------------------------------------------------------------

SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1', 42, 600);
SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1', 137, 600);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 1,
  'three recordings on the same lesson must not become three rows'
);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 137,
  'the recorded position must be the latest one'
);
SELECT pg_temp.assert_true(
  (SELECT opened_at <= last_seen_at FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1'),
  'opened_at is the FIRST opening: it can never be later than last_seen_at'
);

-- A position past the end of the video (the teacher re-recorded the lesson shorter) is discarded,
-- and the one that was valid stays valid -- the learner is not thrown off the timeline.
SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1', 5000, 600);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 137,
  'a position greater than the duration must be ignored'
);

-- EXPLICIT zero resets (the lesson ended); null does not touch the position (it only records
-- the visit). That is what makes reopening the lesson not erase the resume point.
SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1', 0, 600);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 0,
  'an explicit zero must reset the position'
);
SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1', 55, 600);
SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-1');
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'lesson-1') = 55,
  'reopening the lesson (null position) must not erase the resume point'
);

-- ---------------------------------------------------------------------------
-- 3. Lesson from another course, and another person's enrollment: refused
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_refused(
  $$SELECT public.record_lesson_playback('smoke-pb-a', 'lesson-of-other-course', 10, 600)$$,
  'recorded a position on a lesson that does not belong to the course of the enrollment'
);
SELECT pg_temp.assert_refused(
  $$SELECT public.record_lesson_playback('smoke-pb-b', 'lesson-1', 10, 600)$$,
  'recorded on the enrollment of another learner'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. RLS: one learner does not see the other's row
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('33333333-3333-4333-8333-333333333333');
SET LOCAL ROLE authenticated;

SELECT public.record_lesson_playback('smoke-pb-b', 'lesson-1', 200, 600);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a') = 0,
  'learner B can read the row of learner A'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-b') = 1,
  'a learner must be able to read their own row'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. The teacher reads the AGGREGATE of their own course, never the raw row
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback) = 0,
  'the course owner can read the raw rows of their learners'
);

SELECT pg_temp.assert_true(
  (SELECT students_opened FROM public.get_my_course_lesson_funnel()
    WHERE course_id = 'smoke-ci-course' AND lesson_id = 'lesson-1') = 2,
  'the funnel must count the two learners who opened the lesson'
);
SELECT pg_temp.assert_true(
  (SELECT students_completed FROM public.get_my_course_lesson_funnel()
    WHERE course_id = 'smoke-ci-course' AND lesson_id = 'lesson-1') = 0,
  'nobody completed: drop-off is 2 out of 2'
);

-- And the learner list's "last access" gets a value -- the two screens of
-- PR #187 were left without data precisely for lack of this.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_my_course_students()
    WHERE enrollment_id IN ('smoke-pb-a', 'smoke-pb-b')
      AND last_seen_at IS NOT NULL) = 2,
  'get_my_course_students must return the last access of both learners'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Nobody writes to the table through PostgREST: only the function
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'lesson_playback'
      AND p.polcmd <> 'r'   -- 'r' = SELECT
      AND p.polpermissive   -- restrictive limits; does not grant write on its own
  ),
  'lesson_playback must have no permissive write policy: every write goes through the function'
);

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_playback'::regclass),
  'lesson_playback without RLS enabled'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.lesson_playback', 'SELECT'),
  'a logged-out visitor must not be able to read where the learners stopped'
);

-- The learner has an active enrollment and reads their row, but writes only through the RPC.
-- Valid values keep a constraint or SQL error from masking the refusal.
SELECT pg_temp.act_as('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_refused(
  $$INSERT INTO public.lesson_playback(enrollment_id,lesson_id,user_id)
    VALUES('smoke-pb-a','lesson-2','22222222-2222-4222-8222-222222222222')$$,
  'a learner inserted into lesson_playback directly', '42501'
);
SELECT pg_temp.assert_refused(
  $$UPDATE public.lesson_playback SET position_seconds=99
    WHERE enrollment_id='smoke-pb-a' AND lesson_id='lesson-1'$$,
  'a learner updated lesson_playback directly', '42501'
);
SELECT pg_temp.assert_refused(
  $$DELETE FROM public.lesson_playback
    WHERE enrollment_id='smoke-pb-a' AND lesson_id='lesson-1'$$,
  'a learner deleted from lesson_playback directly', '42501'
);
RESET ROLE;

ROLLBACK;

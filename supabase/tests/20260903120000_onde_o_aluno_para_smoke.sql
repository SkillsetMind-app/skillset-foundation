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
CREATE OR REPLACE FUNCTION pg_temp.assert_recusa(
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
SET modules = '[{"id":"m1","lessons":[{"id":"aula-1"},{"id":"aula-2"}]}]'::jsonb
WHERE id = 'smoke-ci-course';

-- A second course, from the same teacher, with a lesson that does NOT belong to
-- the enrollment below -- it is the case "recording on a lesson of another course".
INSERT INTO public.courses (
  id, owner_id, slug, title, summary, category, status,
  currency, price_amount_minor, modules
) VALUES (
  'smoke-playback-outro', '11111111-1111-4111-8111-111111111111',
  'smoke-playback-outro', 'Outro curso', 'Smoke', 'smoke', 'published',
  'brl', 0, '[{"id":"m1","lessons":[{"id":"aula-de-outro-curso"}]}]'::jsonb
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
   'aluno-a@smoke.local', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'aluno-b@smoke.local', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

INSERT INTO public.enrollments (
  id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, progress_percent, created_at, updated_at
) VALUES
  ('smoke-pb-a', '22222222-2222-4222-8222-222222222222', 'smoke-ci-course',
   'smoke-ci-course', 'Smoke CI', 'smoke', '', 'active', 'admin', 0, now(), now()),
  ('smoke-pb-b', '33333333-3333-4333-8333-333333333333', 'smoke-ci-course',
   'smoke-ci-course', 'Smoke CI', 'smoke', '', 'active', 'admin', 0, now(), now());

CREATE OR REPLACE FUNCTION pg_temp.vira(p_uid text) RETURNS void
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

SELECT pg_temp.vira('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;

SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 1,
  'abrir a aula tem de criar a linha do funil'
);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 0,
  'abertura sem posicao comeca em zero'
);

-- ---------------------------------------------------------------------------
-- 2. The position goes up, the row stays ONE, and opened_at does not move
-- ---------------------------------------------------------------------------

SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 42, 600);
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 137, 600);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 1,
  'tres gravacoes na mesma aula nao podem virar tres linhas'
);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 137,
  'a posicao gravada tem de ser a ultima'
);
SELECT pg_temp.assert_true(
  (SELECT opened_at <= last_seen_at FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1'),
  'opened_at e a PRIMEIRA abertura: nunca pode passar de last_seen_at'
);

-- A position past the end of the video (the teacher re-recorded the lesson shorter) is discarded,
-- and the one that was valid stays valid -- the learner is not thrown off the timeline.
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 5000, 600);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 137,
  'posicao maior que a duracao tem de ser ignorada'
);

-- EXPLICIT zero resets (the lesson ended); null does not touch the position (it only records
-- the visit). That is what makes reopening the lesson not erase the resume point.
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 0, 600);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 0,
  'zero explicito tem de zerar a posicao'
);
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 55, 600);
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1');
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 55,
  'reabrir a aula (posicao nula) nao pode apagar o ponto de retomada'
);

-- ---------------------------------------------------------------------------
-- 3. Lesson from another course, and another person's enrollment: refused
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_recusa(
  $$SELECT public.record_lesson_playback('smoke-pb-a', 'aula-de-outro-curso', 10, 600)$$,
  'gravou posicao numa aula que nao pertence ao curso da matricula'
);
SELECT pg_temp.assert_recusa(
  $$SELECT public.record_lesson_playback('smoke-pb-b', 'aula-1', 10, 600)$$,
  'gravou na matricula de outro aluno'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. RLS: one learner does not see the other's row
-- ---------------------------------------------------------------------------

SELECT pg_temp.vira('33333333-3333-4333-8333-333333333333');
SET LOCAL ROLE authenticated;

SELECT public.record_lesson_playback('smoke-pb-b', 'aula-1', 200, 600);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a') = 0,
  'o aluno B esta lendo a linha do aluno A'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-b') = 1,
  'o aluno tem de ler a propria linha'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. The teacher reads the AGGREGATE of their own course, never the raw row
-- ---------------------------------------------------------------------------

SELECT pg_temp.vira('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.lesson_playback) = 0,
  'o dono do curso esta lendo a linha crua dos alunos dele'
);

SELECT pg_temp.assert_true(
  (SELECT students_opened FROM public.get_my_course_lesson_funnel()
    WHERE course_id = 'smoke-ci-course' AND lesson_id = 'aula-1') = 2,
  'o funil tem de contar os dois alunos que abriram a aula'
);
SELECT pg_temp.assert_true(
  (SELECT students_completed FROM public.get_my_course_lesson_funnel()
    WHERE course_id = 'smoke-ci-course' AND lesson_id = 'aula-1') = 0,
  'ninguem concluiu: abandono de 2 em 2'
);

-- And the learner list's "last access" gets a value -- the two screens of
-- PR #187 were left without data precisely for lack of this.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_my_course_students()
    WHERE enrollment_id IN ('smoke-pb-a', 'smoke-pb-b')
      AND last_seen_at IS NOT NULL) = 2,
  'get_my_course_students precisa devolver o ultimo acesso dos dois alunos'
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
  'lesson_playback nao pode ter policy permissiva de escrita: toda escrita passa pela funcao'
);

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_playback'::regclass),
  'lesson_playback sem RLS ligada'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.lesson_playback', 'SELECT'),
  'visitante deslogado nao pode ler onde os alunos pararam'
);

-- The learner has an active enrollment and reads their row, but writes only through the RPC.
-- Valid values keep a constraint or SQL error from masking the refusal.
SELECT pg_temp.vira('22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_recusa(
  $$INSERT INTO public.lesson_playback(enrollment_id,lesson_id,user_id)
    VALUES('smoke-pb-a','aula-2','22222222-2222-4222-8222-222222222222')$$,
  'aluno inseriu lesson_playback diretamente', '42501'
);
SELECT pg_temp.assert_recusa(
  $$UPDATE public.lesson_playback SET position_seconds=99
    WHERE enrollment_id='smoke-pb-a' AND lesson_id='aula-1'$$,
  'aluno atualizou lesson_playback diretamente', '42501'
);
SELECT pg_temp.assert_recusa(
  $$DELETE FROM public.lesson_playback
    WHERE enrollment_id='smoke-pb-a' AND lesson_id='aula-1'$$,
  'aluno excluiu lesson_playback diretamente', '42501'
);
RESET ROLE;

ROLLBACK;

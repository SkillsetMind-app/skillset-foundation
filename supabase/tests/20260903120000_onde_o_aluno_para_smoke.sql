\set ON_ERROR_STOP on

-- Prova, contra um banco de verdade, o que a migracao 20260903120000 promete:
-- a abertura da aula fica gravada, a posicao do video vive no banco (e nao no
-- navegador), a linha e uma so por (matricula, aula), e nem outro aluno nem o
-- professor conseguem ler a linha crua de alguem.
--
-- Seguro contra banco vivo: os dois alunos, o segundo curso e as matriculas
-- nascem e morrem dentro desta transacao, desfeitos no ROLLBACK do fim.
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

-- Recusa esperada. O bloco EXCEPTION abre uma subtransacao: o erro derruba so
-- a tentativa, nao esta transacao inteira.
CREATE OR REPLACE FUNCTION pg_temp.assert_recusa(
  p_sql text,
  p_message text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', p_message;
END;
$$;

-- ---------------------------------------------------------------------------
-- 0. Cenario: um professor (o usuario do seed, dono de smoke-ci-course) e dois
--    alunos diferentes dele.
-- ---------------------------------------------------------------------------

-- Aulas no curso do seed: a funcao recusa aula que nao esta em `modules`.
UPDATE public.courses
SET modules = '[{"id":"m1","lessons":[{"id":"aula-1"},{"id":"aula-2"}]}]'::jsonb
WHERE id = 'smoke-ci-course';

-- Um segundo curso, do mesmo professor, com uma aula que NAO pertence a
-- matricula de baixo -- e o caso "gravar em aula de outro curso".
INSERT INTO public.courses (
  id, owner_id, slug, title, summary, category, status,
  currency, price_amount_minor, modules
) VALUES (
  'smoke-playback-outro', '11111111-1111-4111-8111-111111111111',
  'smoke-playback-outro', 'Outro curso', 'Smoke', 'smoke', 'published',
  'brl', 0, '[{"id":"m1","lessons":[{"id":"aula-de-outro-curso"}]}]'::jsonb
);

-- Os dois alunos. public.users nasce pelo trigger on_auth_user_created, o
-- mesmo caminho de um cadastro real.
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
-- 1. Abrir a aula ja deixa rastro -- hoje so a conclusao deixava
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
-- 2. A posicao sobe, a linha continua sendo UMA, e opened_at nao se move
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

-- Posicao fora da fita (o professor regravou a aula mais curta) e descartada,
-- e a que valia continua valendo -- o aluno nao e jogado para fora da linha.
SELECT public.record_lesson_playback('smoke-pb-a', 'aula-1', 5000, 600);
SELECT pg_temp.assert_true(
  (SELECT position_seconds FROM public.lesson_playback
    WHERE enrollment_id = 'smoke-pb-a' AND lesson_id = 'aula-1') = 137,
  'posicao maior que a duracao tem de ser ignorada'
);

-- Zero EXPLICITO zera (a aula terminou); nulo nao mexe na posicao (so registra
-- a visita). E o que faz reabrir a aula nao apagar o ponto de retomada.
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
-- 3. Aula de outro curso, e matricula de outra pessoa: recusadas
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
-- 4. RLS: um aluno nao ve a linha do outro
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
-- 5. O professor le o AGREGADO do proprio curso, nunca a linha crua
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

-- E o "ultimo acesso" da lista de alunos passa a ter valor -- as duas telas do
-- PR #187 ficaram sem dado exatamente por falta disto.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.get_my_course_students()
    WHERE enrollment_id IN ('smoke-pb-a', 'smoke-pb-b')
      AND last_seen_at IS NOT NULL) = 2,
  'get_my_course_students precisa devolver o ultimo acesso dos dois alunos'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Ninguem escreve na tabela pelo PostgREST: so a funcao
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
  ),
  'lesson_playback nao pode ter policy de escrita: toda escrita passa pela funcao'
);

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_playback'::regclass),
  'lesson_playback sem RLS ligada'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.lesson_playback', 'SELECT'),
  'visitante deslogado nao pode ler onde os alunos pararam'
);

ROLLBACK;

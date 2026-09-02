\set ON_ERROR_STOP on

-- Seguro contra banco vivo: o fator de teste e a matricula de teste nascem e
-- morrem dentro desta transação, desfeitos no ROLLBACK do fim.
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

-- O buraco que sobrou do PR #146: o portão do segundo fator vivia só na tela e
-- nas rotas do app. Um token aal1 de conta com TOTP continuava lendo e
-- escrevendo pelo PostgREST direto, com a chave anon, tudo o que as policies
-- liberam para auth.uid(). Nenhuma policy olhava o AAL.

-- ---------------------------------------------------------------------------
-- 1. A função existe com as propriedades que a tornam segura de usar em policy
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_true(
  to_regprocedure('public.session_is_strong()') IS NOT NULL,
  'public.session_is_strong() nao existe'
);

SELECT pg_temp.assert_true(
  (SELECT p.provolatile = 's' AND p.prosecdef
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'session_is_strong'),
  'session_is_strong precisa ser STABLE e SECURITY DEFINER: sem definer ela nao le auth.mfa_factors'
);

SELECT pg_temp.assert_true(
  (SELECT p.proconfig::text LIKE '%search_path=%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'session_is_strong'),
  'session_is_strong sem search_path fixo: security definer com search_path aberto e sequestravel'
);

-- anon precisa executar. Não é permissão a mais: para anon a função responde
-- TRUE e o predicado de dono segue filtrando. Sem o EXECUTE, toda leitura
-- anônima de tabela cuja policy `TO public` cita a função aborta com 42501 —
-- foi o incidente de 20260901120000_restore_anon_execute_on_rls_predicates.
SELECT pg_temp.assert_true(
  has_function_privilege('anon', 'public.session_is_strong()', 'EXECUTE'),
  'anon sem EXECUTE em session_is_strong: leitura publica vai abortar com 42501'
);

-- ---------------------------------------------------------------------------
-- 2. Toda policy da lista carrega o portão
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  alvo text[][] := array[
    ['courses', 'courses_insert_owner'],
    ['courses', 'courses_update_owner'],
    ['courses', 'courses_delete_owner'],
    ['course_lesson_content', 'course_lesson_content_insert_owner'],
    ['course_lesson_content', 'course_lesson_content_update_owner'],
    ['course_lesson_content', 'course_lesson_content_delete'],
    ['course_assets', 'course_assets_insert'],
    ['course_assets', 'course_assets_update_owner'],
    ['course_assets', 'course_assets_delete_owner'],
    ['users', 'users_update_self'],
    ['custom_domains', 'custom_domains_select_owner'],
    ['payout_ledger', 'payout_ledger_owner_sel'],
    ['payout_ledger', 'payout_ledger_teacher_read'],
    ['orders', 'orders_owner_sel'],
    ['orders', 'orders_teacher_read'],
    ['payments', 'payments_owner_sel'],
    ['enrollments', 'enrollments_select_owner'],
    ['lesson_comments', 'lesson_comments_insert']
  ];
  i int;
  expressao text;
BEGIN
  FOR i IN 1 .. array_length(alvo, 1) LOOP
    SELECT coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO expressao
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo[i][1] AND p.polname = alvo[i][2];

    IF expressao IS NULL OR expressao NOT LIKE '%session_is_strong%' THEN
      RAISE EXCEPTION
        'SMOKE_ASSERTION_FAILED: policy %.% sem o portao do segundo fator',
        alvo[i][1], alvo[i][2];
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Comportamento, com um usuário real e um curso real deste banco
-- ---------------------------------------------------------------------------

SELECT u.id::text AS test_uid
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id)
LIMIT 1
\gset

SELECT c.id AS test_course
FROM public.courses c
LIMIT 1
\gset

-- Quem NÃO usa segundo fator não muda nada: aal1 continua valendo.
SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal1')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'conta sem fator verificado: aal1 tem de continuar valendo, senao a plataforma inteira para'
);
RESET ROLE;

-- A partir daqui a conta tem TOTP verificado. Sem valor de segredo: a coluna é
-- opcional e o que decide é o status.
INSERT INTO auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
VALUES (gen_random_uuid(), :'test_uid'::uuid, 'totp', 'verified', now(), now());

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT public.session_is_strong(),
  'conta com fator verificado: a sessao aal1 nao pode mais valer'
);
RESET ROLE;

-- A mesma sessão, depois do código de 6 dígitos, volta a valer.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'depois do codigo (aal2) a mesma conta volta a valer'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. A policy MORDE: a matrícula do próprio aluno some com a sessão fraca
-- ---------------------------------------------------------------------------

INSERT INTO public.enrollments (
  id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, progress_percent, created_at, updated_at
) VALUES (
  'smoke-aal2__' || :'test_uid', :'test_uid', :'test_course', 'smoke-aal2',
  'Smoke AAL2', 'smoke', '', 'active', 'admin', 0, now(), now()
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.enrollments WHERE id = 'smoke-aal2__' || :'test_uid') = 1,
  'com aal2 o aluno tem de continuar vendo a propria matricula'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal1')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.enrollments WHERE id = 'smoke-aal2__' || :'test_uid') = 0,
  'sessao aal1 de conta com TOTP ainda le a matricula pelo PostgREST: o portao nao esta na policy'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Visitante deslogado: a função responde, não aborta
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'anon precisa conseguir executar a funcao e receber TRUE, senao a leitura publica aborta'
);
RESET ROLE;

ROLLBACK;

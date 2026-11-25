\set ON_ERROR_STOP on

-- Safe against a live database: the test factor and the test enrollment are born and
-- die inside this transaction, undone by the ROLLBACK at the end.
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

-- The hole left over from PR #146: the second-factor gate lived only on the screen and
-- in the app's routes. An aal1 token for an account with TOTP kept reading and
-- writing straight through PostgREST, with the anon key, everything the policies
-- allow for auth.uid(). No policy looked at the AAL.

-- ---------------------------------------------------------------------------
-- 1. The function exists with the properties that make it safe to use in a policy
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_true(
  to_regprocedure('public.session_is_strong()') IS NOT NULL,
  'public.session_is_strong() does not exist'
);

SELECT pg_temp.assert_true(
  (SELECT p.provolatile = 's' AND p.prosecdef
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'session_is_strong'),
  'session_is_strong must be STABLE and SECURITY DEFINER: without definer it cannot read auth.mfa_factors'
);

SELECT pg_temp.assert_true(
  (SELECT p.proconfig::text LIKE '%search_path=%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'session_is_strong'),
  'session_is_strong has no fixed search_path: a security definer function with an open search_path can be hijacked'
);

-- anon must be able to execute it. It is not extra permission: for anon the function answers
-- TRUE and the owner predicate keeps filtering. Without the EXECUTE, every anonymous
-- read of a table whose `TO public` policy cites the function aborts with 42501 —
-- that was the incident of 20260901120000_restore_anon_execute_on_rls_predicates.
SELECT pg_temp.assert_true(
  has_function_privilege('anon', 'public.session_is_strong()', 'EXECUTE'),
  'anon has no EXECUTE on session_is_strong: public reads will abort with 42501'
);

-- ---------------------------------------------------------------------------
-- 2. Every policy in the list carries the gate
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
  policy_expr text;
BEGIN
  FOR i IN 1 .. array_length(alvo, 1) LOOP
    SELECT coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO policy_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo[i][1] AND p.polname = alvo[i][2];

    IF policy_expr IS NULL OR policy_expr NOT LIKE '%session_is_strong%' THEN
      RAISE EXCEPTION
        'SMOKE_ASSERTION_FAILED: policy %.% has no second-factor gate',
        alvo[i][1], alvo[i][2];
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Behavior, with a real user and a real course from this database
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

-- Whoever does NOT use a second factor sees no change: aal1 keeps working.
SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal1')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'account without a verified factor: aal1 must keep working, otherwise the whole platform stops'
);
RESET ROLE;

-- From here on the account has a verified TOTP. No secret value: the column is
-- optional and what decides is the status.
INSERT INTO auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
VALUES (gen_random_uuid(), :'test_uid'::uuid, 'totp', 'verified', now(), now());

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT public.session_is_strong(),
  'account with a verified factor: the aal1 session must no longer be valid'
);
RESET ROLE;

-- The same session, after the 6-digit code, is valid again.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'after the code (aal2) the same account is valid again'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. The policy BITES: the learner's own enrollment disappears with the weak session
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
  'with aal2 the learner must still see their own enrollment'
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
  'aal1 session of an account with TOTP still reads the enrollment through PostgREST: the gate is not in the policy'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Logged-out visitor: the function answers, it does not abort
-- ---------------------------------------------------------------------------

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(
  public.session_is_strong(),
  'anon must be able to execute the function and receive TRUE, otherwise public reads abort'
);
RESET ROLE;

ROLLBACK;

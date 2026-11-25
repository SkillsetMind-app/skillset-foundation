\set ON_ERROR_STOP on
-- Disposable test database: everything is born and dies in this transaction (ROLLBACK).
--
-- The bug: advisor_conversations and advisor_messages accepted a direct INSERT from
-- `authenticated`, so any logged-in account could write Advisor history
-- through PostgREST without the route's quota of 30/h and 120/day. Now the only door is
-- save_advisor_turn. Without migration 20260910050000 this file turns
-- red: the privilege checks fail and the function does not exist.
BEGIN;
CREATE TEMP TABLE advisor_checks (name text, passed boolean);
GRANT INSERT, SELECT ON advisor_checks TO authenticated;
CREATE FUNCTION pg_temp.check_advisor(p_name text, p_ok boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO advisor_checks VALUES (p_name, coalesce(p_ok, false)); $$;
CREATE FUNCTION pg_temp.assume_session(p_uid uuid, p_role text, p_aal text DEFAULT 'aal1') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', p_aal)::text, true);
END $$;
-- SQLSTATE and error message, or 'ok'. Rolls back up to the command that passed.
CREATE FUNCTION pg_temp.outcome(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION USING ERRCODE = 'Z0001';
EXCEPTION
  WHEN SQLSTATE 'Z0001' THEN RETURN 'ok';
  WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

SELECT gen_random_uuid() AS teacher_uid, gen_random_uuid() AS other_uid,
       gen_random_uuid() AS student_uid, gen_random_uuid() AS mfa_uid \gset
SELECT pg_temp.assume_session(NULL, 'service_role');
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  (:'teacher_uid', 'authenticated', 'authenticated', :'teacher_uid' || '@example.invalid', now(), now(), now(), '{}', '{}'),
  (:'other_uid', 'authenticated', 'authenticated', :'other_uid' || '@example.invalid', now(), now(), now(), '{}', '{}'),
  (:'student_uid', 'authenticated', 'authenticated', :'student_uid' || '@example.invalid', now(), now(), now(), '{}', '{}'),
  (:'mfa_uid', 'authenticated', 'authenticated', :'mfa_uid' || '@example.invalid', now(), now(), now(), '{}', '{}');
UPDATE public.users
SET roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'advisor-quota-test'
WHERE uid IN (:'teacher_uid', :'other_uid', :'mfa_uid');
INSERT INTO auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
VALUES (gen_random_uuid(), :'mfa_uid', 'totp', 'verified', now(), now());

-- ---------------------------------------------------------------------------
-- 1. Catalog: the direct INSERT left the API roles; anon cannot call the RPC.
-- ---------------------------------------------------------------------------
SELECT pg_temp.check_advisor('authenticated has no direct INSERT on advisor_conversations',
  NOT has_table_privilege('authenticated', 'public.advisor_conversations', 'INSERT'));
SELECT pg_temp.check_advisor('authenticated has no direct INSERT on advisor_messages',
  NOT has_table_privilege('authenticated', 'public.advisor_messages', 'INSERT'));
SELECT pg_temp.check_advisor('anon has no direct INSERT on either table',
  NOT has_table_privilege('anon', 'public.advisor_conversations', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.advisor_messages', 'INSERT'));
SELECT pg_temp.check_advisor('anon cannot call save_advisor_turn',
  to_regprocedure('public.save_advisor_turn(uuid,text,text,text)') IS NOT NULL
  AND NOT has_function_privilege('anon', 'public.save_advisor_turn(uuid,text,text,text)', 'EXECUTE'));

-- ---------------------------------------------------------------------------
-- 2. The owner teacher: writes through the RPC, not the table, and hits the quota.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assume_session(:'teacher_uid', 'authenticated');
SET LOCAL ROLE authenticated;

SELECT pg_temp.check_advisor('direct INSERT of a conversation is refused',
  pg_temp.outcome(format(
    'INSERT INTO public.advisor_conversations (teacher_id, title) VALUES (%L, %L)',
    :'teacher_uid', 'direct')) LIKE '42501 %');

SELECT public.save_advisor_turn(NULL, 'Preco', 'How should I price this?', 'Start at 49 and test.') AS conv \gset

SELECT pg_temp.check_advisor('the RPC stores a new thread with its question and answer',
  (SELECT count(*) = 2 FROM public.advisor_messages WHERE conversation_id = :'conv'));
SELECT pg_temp.check_advisor('the new thread belongs to the caller',
  (SELECT teacher_id = :'teacher_uid'::uuid FROM public.advisor_conversations WHERE id = :'conv'));
SELECT pg_temp.check_advisor('direct INSERT of a message into an own thread is refused',
  pg_temp.outcome(format(
    'INSERT INTO public.advisor_messages (conversation_id, role, content) VALUES (%L, %L, %L)',
    :'conv', 'user', 'direct')) LIKE '42501 %');
SELECT pg_temp.check_advisor('continuing a thread keeps its id',
  public.save_advisor_turn(:'conv', NULL, 'And the description?', 'Lead with the outcome.') = :'conv'::uuid);

-- Two turns were spent above; the burst completes 30 within the same hour.
DO $$
BEGIN
  FOR i IN 3..30 LOOP
    PERFORM public.save_advisor_turn(NULL, 'Rajada', 'q', 'a');
  END LOOP;
END $$;
SELECT pg_temp.check_advisor('the 31st turn inside the hour is refused by the quota',
  pg_temp.outcome($q$SELECT public.save_advisor_turn(NULL, NULL, 'q', 'a')$q$) = 'P0001 RATE_LIMIT');

-- ---------------------------------------------------------------------------
-- 3. Who cannot write: another teacher, an account with no role, a weak session.
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.assume_session(:'other_uid', 'authenticated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_advisor('another teacher cannot write into the thread',
  pg_temp.outcome(format('SELECT public.save_advisor_turn(%L, NULL, %L, %L)', :'conv', 'q', 'a')) LIKE '42501 %');

RESET ROLE;
SELECT pg_temp.assume_session(:'student_uid', 'authenticated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_advisor('an account without the teacher role cannot store turns',
  pg_temp.outcome($q$SELECT public.save_advisor_turn(NULL, NULL, 'q', 'a')$q$) LIKE '42501 %');

RESET ROLE;
SELECT pg_temp.assume_session(:'mfa_uid', 'authenticated', 'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_advisor('an aal1 session of an account with a second factor is refused',
  pg_temp.outcome($q$SELECT public.save_advisor_turn(NULL, NULL, 'q', 'a')$q$) LIKE '42501 %');

RESET ROLE;
SELECT pg_temp.assume_session(:'mfa_uid', 'authenticated', 'aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_advisor('the same account with aal2 stores the turn',
  pg_temp.outcome($q$SELECT public.save_advisor_turn(NULL, NULL, 'q', 'a')$q$) = 'ok');

-- ---------------------------------------------------------------------------
-- 4. Both quota buckets (hour and day) were spent on every turn written.
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.check_advisor('each stored turn spends both the hourly and the daily budget',
  (SELECT count(*) = 2 FROM public.rate_limits
    WHERE key IN ('advisor_turn_' || :'teacher_uid', 'advisor_turn_daily_' || :'teacher_uid')
      AND count = 30));

DO $$
DECLARE
  falhas text;
  total integer;
BEGIN
  SELECT string_agg(name, '; '), count(*) INTO falhas, total FROM advisor_checks WHERE NOT passed;
  IF falhas IS NOT NULL THEN
    RAISE EXCEPTION 'ADVISOR_QUOTA_REGRESSION: %', falhas;
  END IF;
  SELECT count(*) INTO total FROM advisor_checks;
  IF total <> 15 THEN
    RAISE EXCEPTION 'ADVISOR_QUOTA_REGRESSION: expected 15 checks, ran %', total;
  END IF;
END $$;

ROLLBACK;

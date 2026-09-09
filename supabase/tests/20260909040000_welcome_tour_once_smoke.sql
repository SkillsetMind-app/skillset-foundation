\set ON_ERROR_STOP on
-- Synthetic accounts in CI's disposable database. Never run against production.
BEGIN;
CREATE FUNCTION pg_temp.check_tour(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'WELCOME_TOUR_REGRESSION: %', message; END IF; END $$;
CREATE FUNCTION pg_temp.tour_actor(uid text, aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', uid, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
END $$;
CREATE FUNCTION pg_temp.tour_denied(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'WELCOME_TOUR_REGRESSION: request was accepted';
END $$;

SELECT pg_temp.check_tour(to_regprocedure('public.claim_welcome_tour(text,text)') IS NOT NULL, 'account-scoped claim is missing');
SELECT pg_temp.check_tour(NOT has_function_privilege('anon', 'public.claim_welcome_tour(text,text)', 'EXECUTE'), 'anonymous claim is exposed');
SELECT pg_temp.check_tour(has_function_privilege('authenticated', 'public.claim_welcome_tour(text,text)', 'EXECUTE'), 'authenticated claim unavailable');

INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
('99999999-9999-4999-8999-999999999991', 'authenticated', 'authenticated', 'tour-student@example.test', now(), '{}', '{}', now(), now()),
('99999999-9999-4999-8999-999999999992', 'authenticated', 'authenticated', 'tour-teacher@example.test', now(), '{}', '{}', now(), now());
SELECT pg_temp.check_tour((SELECT count(*) = 2 FROM public.users WHERE uid IN ('99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992') AND welcome_tour_seen_at IS NULL), 'new signups must remain eligible');
INSERT INTO public.platform_settings(key, value) VALUES ('require_activation_fee', 'true') ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value;

SELECT pg_temp.tour_actor('99999999-9999-4999-8999-999999999991');
SELECT set_config('skillset.trusted_write', 'off', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'student'), 'unfinished registration consumed the tour');
SELECT pg_temp.tour_denied($q$SELECT public.claim_welcome_tour('99999999-9999-4999-8999-999999999992','student')$q$, '42501');
SELECT pg_temp.tour_denied($q$SELECT public.claim_welcome_tour(null,'student')$q$, '42501');
SELECT pg_temp.tour_denied($q$SELECT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991','ops')$q$, '22023');
UPDATE public.users SET onboarding_completed = true, preferences = '{"learning":{"autoCaptions":true}}' WHERE uid = auth.uid()::text;
SELECT pg_temp.check_tour(public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'student'), 'new learner needs the first tour without activation payment');
-- now() is constant inside a transaction. A historical value catches an
-- accidental timestamp rewrite that two calls using now() would hide.
UPDATE public.users SET welcome_tour_seen_at = '2020-01-01T00:00:00Z' WHERE uid = auth.uid()::text;
SELECT set_config('smoke.tour_seen', (SELECT welcome_tour_seen_at::text FROM public.users WHERE uid = auth.uid()::text), true);
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'student'), 'second visit repeated the tour');
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'teacher'), 'switching workspace repeated the tour');
UPDATE public.users SET bio = 'Updated bio', preferences = '{"learning":{"autoCaptions":false}}' WHERE uid = auth.uid()::text;
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'student'), 'editing preferences reset the tour');
SELECT pg_temp.check_tour((SELECT welcome_tour_seen_at::text = current_setting('smoke.tour_seen') AND activation_fee_paid_at IS NULL AND preferences = '{"learning":{"autoCaptions":false}}'::jsonb AND roles = '["student"]'::jsonb FROM public.users WHERE uid = auth.uid()::text), 'claim changed billing, preferences, roles or first timestamp');
RESET ROLE;

-- A verified second factor must remain a boundary, even for this small RPC.
INSERT INTO auth.mfa_factors(id, user_id, factor_type, status, created_at, updated_at)
VALUES (gen_random_uuid(), '99999999-9999-4999-8999-999999999992', 'totp', 'verified', now(), now());
SELECT pg_temp.tour_actor('99999999-9999-4999-8999-999999999992', 'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.tour_denied($q$SELECT public.claim_welcome_tour('99999999-9999-4999-8999-999999999992','teacher')$q$, '42501');
RESET ROLE;
SELECT pg_temp.tour_actor('99999999-9999-4999-8999-999999999992');
SET LOCAL ROLE authenticated;
UPDATE public.users SET onboarding_completed = true, roles = '["teacher"]' WHERE uid = auth.uid()::text;
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999992', 'teacher'), 'unpaid creator consumed the tour behind the activation wall');
SELECT pg_temp.check_tour((SELECT welcome_tour_seen_at IS NULL FROM public.users WHERE uid = auth.uid()::text), 'ineligible claim marked the tour as seen');
RESET ROLE;
SELECT set_config('skillset.trusted_write', 'on', true);
UPDATE public.users SET activation_fee_paid_at = now() WHERE uid = '99999999-9999-4999-8999-999999999992';
SELECT set_config('skillset.trusted_write', 'off', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_tour(public.claim_welcome_tour('99999999-9999-4999-8999-999999999992', 'teacher'), 'activated creator cannot see first tour');
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999992', 'student'), 'activated creator receives a second tour in the learner workspace');
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999992', 'teacher'), 'creator tour repeated');
RESET ROLE;

SELECT pg_temp.tour_actor(null);
SET LOCAL ROLE authenticated;
SELECT pg_temp.tour_denied($q$SELECT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991','student')$q$, '42501');
RESET ROLE;

-- Replay the actual upgrade with pre-existing profiles, inside this rollback.
-- This destructive schema exercise is only for CI's disposable database.
DROP FUNCTION public.claim_welcome_tour(text, text);
ALTER TABLE public.users DROP COLUMN welcome_tour_seen_at;
\ir ../migrations/20260909040000_welcome_tour_once.sql
SELECT pg_temp.check_tour((SELECT count(*) = 2 FROM public.users WHERE uid IN ('99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992') AND welcome_tour_seen_at IS NOT NULL), 'upgrade reopens the tour for existing accounts');
SELECT pg_temp.tour_actor('99999999-9999-4999-8999-999999999991');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_tour(NOT public.claim_welcome_tour('99999999-9999-4999-8999-999999999991', 'student'), 'legacy account receives a new interruption');
RESET ROLE;
INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('99999999-9999-4999-8999-999999999993', 'authenticated', 'authenticated', 'tour-after-upgrade@example.test', now(), '{}', '{}', now(), now());
SELECT pg_temp.check_tour((SELECT welcome_tour_seen_at IS NULL FROM public.users WHERE uid = '99999999-9999-4999-8999-999999999993'), 'upgrade default suppresses future signups');
ROLLBACK;

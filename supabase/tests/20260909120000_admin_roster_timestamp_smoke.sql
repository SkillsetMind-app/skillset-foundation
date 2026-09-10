\set ON_ERROR_STOP on
-- Disposable database only. Real RPC, roles and MFA checks; fixtures roll back.
BEGIN;
CREATE TEMP TABLE roster_checks (name text, passed boolean);
GRANT INSERT, SELECT ON roster_checks TO anon, authenticated;
CREATE FUNCTION pg_temp.check_roster(p_name text, p_ok boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO roster_checks VALUES (p_name, coalesce(p_ok,false)); $$;
CREATE FUNCTION pg_temp.assume_session(p_uid uuid, p_role text, p_aal text DEFAULT 'aal1') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',coalesce(p_uid::text,''),true);
  PERFORM set_config('request.jwt.claim.role',p_role,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role',p_role,'aal',p_aal)::text,true);
END $$;
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION USING ERRCODE='Z0001';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN true;
  WHEN SQLSTATE 'Z0001' THEN RETURN false;
END $$;

SELECT gen_random_uuid() AS admin_uid, gen_random_uuid() AS older_uid,
 gen_random_uuid() AS newer_uid, gen_random_uuid()::text AS marker \gset
SELECT pg_temp.check_roster('execute grants remain limited to authenticated and service roles',
 NOT has_function_privilege('anon','public.admin_list_platform_users(text,integer)','EXECUTE')
 AND has_function_privilege('authenticated','public.admin_list_platform_users(text,integer)','EXECUTE')
 AND has_function_privilege('service_role','public.admin_list_platform_users(text,integer)','EXECUTE'));
SELECT pg_temp.assume_session(null,'service_role');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 (:'admin_uid','authenticated','authenticated',:'admin_uid' || '@example.invalid',now(),now(),now(),'{}','{}'),
 (:'older_uid','authenticated','authenticated',:'older_uid' || '@example.invalid',now(),now(),now(),'{}','{}'),
 (:'newer_uid','authenticated','authenticated',:'newer_uid' || '@example.invalid',now(),now(),now(),'{}','{}');
UPDATE public.users SET roles='["student","admin"]' WHERE uid=:'admin_uid';
UPDATE public.users SET display_name=:'marker' || ' Older', created_at='2026-01-02T03:04:05.123456Z'
 WHERE uid=:'older_uid';
UPDATE public.users SET display_name=:'marker' || ' Newer', created_at='2026-02-02T03:04:05.123456Z'
 WHERE uid=:'newer_uid';

SELECT pg_temp.assume_session(:'admin_uid','authenticated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_roster('admin without enrolled MFA can read a timestamp as text',
 (SELECT uid=:'older_uid' AND pg_typeof(created_at)='text'::regtype
   AND created_at::timestamptz='2026-01-02T03:04:05.123456Z'::timestamptz
  FROM public.admin_list_platform_users('  ' || upper(:'older_uid') || '@EXAMPLE.INVALID  ',1)));
SELECT pg_temp.check_roster('name search is case insensitive and sorted newest first',
 (SELECT array_agg(uid ORDER BY ordinality)=ARRAY[:'newer_uid',:'older_uid']
  FROM public.admin_list_platform_users(upper(:'marker'),null) WITH ORDINALITY));
SELECT pg_temp.check_roster('zero limit is clamped to one',
 (SELECT count(*)=1 FROM public.admin_list_platform_users(:'marker',0)));
SELECT pg_temp.check_roster('unmatched search returns no profiles',
 NOT EXISTS(SELECT FROM public.admin_list_platform_users(:'marker' || ' missing')));
RESET ROLE;

INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 VALUES(gen_random_uuid(),:'admin_uid','totp','verified',now(),now());
SELECT pg_temp.assume_session(:'admin_uid','authenticated','aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_roster('admin with enrolled MFA cannot bypass the second factor',pg_temp.denied(
 $$SELECT * FROM public.admin_list_platform_users()$$));
RESET ROLE;
SELECT pg_temp.assume_session(:'admin_uid','authenticated','aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_roster('aal2 admin retains roster access',
 (SELECT count(*)=2 FROM public.admin_list_platform_users(:'marker')));
RESET ROLE;
SELECT pg_temp.assume_session(:'older_uid','authenticated','aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_roster('aal2 alone does not grant administrator privileges',pg_temp.denied(
 $$SELECT * FROM public.admin_list_platform_users()$$));
RESET ROLE;
SELECT pg_temp.assume_session(null,'anon');
SET LOCAL ROLE anon;
SELECT pg_temp.check_roster('anonymous cannot execute the roster RPC',pg_temp.denied(
 $$SELECT * FROM public.admin_list_platform_users()$$));
RESET ROLE;

SELECT name, passed FROM roster_checks ORDER BY name;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name,', ') INTO failures FROM roster_checks WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'ADMIN_ROSTER_REGRESSION: %',failures; END IF;
END $$;
ROLLBACK;

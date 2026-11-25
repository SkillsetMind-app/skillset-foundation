\set ON_ERROR_STOP on

-- Safe against a live database: it only reads the permissions catalog and writes nothing.
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

-- `claim_custom_domain` promises, in its own body, that a domain "is never born
-- active -- Vercel is the one who decides". `sync_own_custom_domain` undid that:
-- it was EXECUTE for `authenticated` and wrote the status coming from the argument, so
-- the creator could call it through PostgREST with their own JWT and declare
-- verified a hostname that never went through Vercel -- getting it into
-- `public_domains`, which is what the proxy reads to decide whose storefront is
-- served on that host.
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_own_custom_domain(text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.sync_own_custom_domain(text,text,text,text,text)',
    'EXECUTE'
  ),
  'sync_own_custom_domain must not be reachable by an end-user role'
);

-- The replacement is service-role only: the verification status is a fact of the
-- server (the route just asked Vercel), never a declaration by the owner.
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'sync_custom_domain_status must be service-role-only'
);

ROLLBACK;

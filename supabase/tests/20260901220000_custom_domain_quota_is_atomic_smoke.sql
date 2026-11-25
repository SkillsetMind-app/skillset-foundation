\set ON_ERROR_STOP on

-- Safe against a live database: the plan change and the claimed domains stay
-- inside this transaction and are undone in the ROLLBACK.
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

-- `claim_custom_domain` counted the owner's domains and inserted without locking anything
-- in between. In READ COMMITTED, two simultaneous calls read the same count, both
-- passed the quota and both inserted: a teacher on starter (quota 1)
-- ended up with N domains, each one attached to the platform's Vercel project.
--
-- The race itself does not fit in a single psql session. What THIS session proves, on the
-- real database: (1) the live definition locks the owner's row in `users` with
-- `for update` BEFORE the count -- `.` matches a line break in Postgres's default regex,
-- so the order is part of the assertion; and (2) the quota still holds
-- after the redefinition, as the logged-in teacher sees it.
SELECT pg_temp.assert_true(
  pg_get_functiondef('public.claim_custom_domain(text)'::regprocedure)
    ~* 'from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s+for\s+update.*count\(\*\)',
  'claim_custom_domain must lock the owner row (for update) before counting domains'
);

-- A user with no domain, put on starter (quota 1) only inside this transaction.
-- The users_field_guard trigger refuses to change the plan without the trusted
-- write flag; it is local to the transaction and dies in the ROLLBACK with the rest.
SELECT u.uid AS test_uid
FROM public.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.custom_domains d WHERE d.owner_uid = u.uid
)
LIMIT 1
\gset

SELECT set_config('skillset.trusted_write', 'on', true);
UPDATE public.users SET current_plan_id = 'starter' WHERE uid = :'test_uid';
SELECT set_config('skillset.trusted_write', 'off', true);

SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_id text;
BEGIN
  v_id := public.claim_custom_domain('smoke-quota-a.example');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: first claim within quota was refused';
  END IF;

  BEGIN
    PERFORM public.claim_custom_domain('smoke-quota-b.example');
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: second claim on a 1-domain plan was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'domain quota reached%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

RESET ROLE;

ROLLBACK;

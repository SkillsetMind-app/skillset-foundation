\set ON_ERROR_STOP on

-- Safe against a live database: every attempted profile change is rolled back.
BEGIN;

SELECT uid AS test_uid
FROM public.users
WHERE NOT (roles ? 'admin')
LIMIT 1
\gset

SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    UPDATE public.users
    SET creator_verification_status = CASE
      WHEN creator_verification_status = 'approved' THEN 'pending'
      ELSE 'approved'
    END
    WHERE uid = auth.uid()::text;
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: verification status update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'users: creator gate fields are server-controlled%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE public.users
    SET activation_fee_paid_at = CASE
      WHEN activation_fee_paid_at IS NULL THEN now()
      ELSE NULL
    END
    WHERE uid = auth.uid()::text;
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: activation timestamp update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'users: creator gate fields are server-controlled%' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.users
  SET display_name = display_name
  WHERE uid = auth.uid()::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: ordinary self-profile update was blocked';
  END IF;
END;
$$;

ROLLBACK;

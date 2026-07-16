\set ON_ERROR_STOP on

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

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'public_media_select_owner'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY (roles)
      AND qual LIKE '%public-media%'
      AND qual LIKE '%users%'
      AND qual LIKE '%courses%'
  ),
  'public-media owners need SELECT access for Storage upload/upsert metadata'
);

ROLLBACK;

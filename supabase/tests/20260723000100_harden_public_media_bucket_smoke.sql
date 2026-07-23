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

-- The public bucket must cap size and accept only raster images. A null
-- allowed_mime_types (the pre-migration "any type" state) fails the @> checks,
-- so this also catches an un-applied migration.
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'public-media'
      AND file_size_limit = 26214400
      AND allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
      AND NOT (allowed_mime_types @> array['image/svg+xml']::text[])
  ),
  'public-media must cap at 25MB and allow only raster image types (no svg)'
);

ROLLBACK;

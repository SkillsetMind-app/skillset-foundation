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

-- O bucket privado aceita o que o app envia (PDF, vídeo, áudio, download) e
-- recusa conteúdo ativo. allowed_mime_types nulo (o estado de antes, "qualquer
-- tipo") reprova o @>, então isto também pega a migration não aplicada.
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'course-content'
      AND allowed_mime_types @> array['application/pdf', 'video/*', 'audio/*', 'application/octet-stream']::text[]
      AND NOT (allowed_mime_types && array[
        'image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml',
        'image/*', 'text/*', 'application/*'
      ]::text[])
  ),
  'course-content must accept app uploads and reject svg/html/xml (no image/*, text/* or application/* wildcard)'
);

-- A trava é de tipo; o bucket continua privado.
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'course-content' AND public = false),
  'course-content must stay private'
);

ROLLBACK;

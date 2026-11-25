\set ON_ERROR_STOP on

-- Safe against a live database: it only reads the policy catalog, it writes nothing.
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

-- Writing to the paid classroom needs the same right as reading. Without
-- this, a former learner (refunded, revoked, expired) keeps posting in a
-- place he can no longer read — the `enrollments` row is never deleted, it only
-- changes status, and the old predicate only asked whether it existed.
SELECT pg_temp.assert_true(
  COALESCE(
    pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%e.status%',
    false
  ),
  'lesson_comments_insert must require a live enrollment (active/completed)'
)
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'lesson_comments'
  AND p.polname = 'lesson_comments_insert';

-- And the policy has to exist: a SELECT with no rows does not run the assertion above,
-- so the zero-row result would be a false green.
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'lesson_comments'
      AND p.polname = 'lesson_comments_insert'
  ),
  'lesson_comments_insert policy is missing'
);

-- The whole guard, against the real database: no policy may query
-- `enrollments` without also checking the status — in USING **or** in WITH CHECK.
-- The version from 20260809080000 read only `polqual` (USING) and so it walked
-- right over every INSERT policy.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    CROSS JOIN LATERAL (
      SELECT COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
        || ' '
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS predicado
    ) x
    WHERE x.predicado ILIKE '%enrollments%'
      AND x.predicado NOT ILIKE '%e.status%'
      -- Documented exception: it returns the user's OWN history, which is theirs
      -- whatever the enrollment status is.
      AND p.polname <> 'lesson_progress_select_owner'
      -- Documented exception: it is the only DELETE policy here, and in it the
      -- question is the inverse. The others query `enrollments` to GRANT
      -- access, and there a dead row cannot count. This query is used to
      -- REFUSE: a refunded, revoked or expired enrollment is still
      -- the learner's record, and `enrollments_course_id_fkey` is RESTRICT — the database
      -- would already block the DELETE with a 23503. The policy states the same rule where
      -- whoever reads RLS looks, and returns zero rows instead of a foreign key
      -- error. Filtering by status here would OPEN the hole instead of
      -- closing it: a course with a dead enrollment would become deletable again.
      -- See 20260908120000_excluir_ou_arquivar_curso_do_professor.sql.
      AND p.polname <> 'courses_delete_owner'
  ),
  'some RLS policy reads enrollments without checking status'
);

ROLLBACK;

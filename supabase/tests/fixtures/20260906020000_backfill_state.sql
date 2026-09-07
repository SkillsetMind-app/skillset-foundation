\set ON_ERROR_STOP on
-- Compare only synthetic fixture state and presence of the first DDL objects.
-- A failed migration must leave every original inline/private value untouched,
-- including timestamps and authorial NULLs. No lesson content is printed.
SELECT md5(jsonb_build_object(
  'courses',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.courses c
    WHERE c.id IN ('upgrade-backfill-course','upgrade-backfill-conflict')),
  'private_lessons',(SELECT jsonb_agg(to_jsonb(lc) ORDER BY lc.lesson_id) FROM public.course_lesson_content lc
    WHERE lc.course_id IN ('upgrade-backfill-course','upgrade-backfill-conflict')),
  'mfa_guard',to_regprocedure('public.require_strong_session()')::text,
  'curriculum_guard',to_regprocedure('public.course_public_curriculum(jsonb)')::text
)::text);

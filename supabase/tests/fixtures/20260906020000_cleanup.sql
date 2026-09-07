\set ON_ERROR_STOP on
-- Remove only this disposable fixture, both before and after the new FKs.
DELETE FROM public.community_reports WHERE id='upgrade-legacy-report';
DELETE FROM public.community_posts WHERE id='upgrade-legacy-post';
DELETE FROM public.courses WHERE id IN ('upgrade-backfill-course','upgrade-backfill-conflict');
DELETE FROM public.users WHERE uid='22222222-2222-4222-8222-222222222222';
DELETE FROM auth.users WHERE id='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.courses WHERE id IN ('upgrade-backfill-course','upgrade-backfill-conflict'))
     OR EXISTS (SELECT FROM public.course_lesson_content WHERE course_id IN ('upgrade-backfill-course','upgrade-backfill-conflict'))
     OR EXISTS (SELECT FROM public.community_posts WHERE id='upgrade-legacy-post')
     OR EXISTS (SELECT FROM public.community_comments WHERE id='upgrade-legacy-comment')
     OR EXISTS (SELECT FROM public.community_reports WHERE id='upgrade-legacy-report')
     OR EXISTS (SELECT FROM public.users WHERE uid='22222222-2222-4222-8222-222222222222')
     OR EXISTS (SELECT FROM auth.users WHERE id='22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'UPGRADE_FIXTURE_CLEANUP_FAILED';
  END IF;
END $$;

\set ON_ERROR_STOP on
-- Executado pelo build-test-db.sh depois da migration, antes do COMMIT.
-- Uma falha reverte fixture E migration; sucesso remove só estas fixtures.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM public.course_lesson_content
    WHERE lesson_id='upgrade-legacy' AND course_id='upgrade-backfill-course'
      AND content_text='LEGACY_PRIVATE_FIXTURE'
      AND external_url='https://example.invalid/legacy'
  ) THEN
    RAISE EXCEPTION 'UPGRADE_BACKFILL_REGRESSION: legacy private content was not migrated';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.course_lesson_content
    WHERE lesson_id='upgrade-cleared' AND course_id='upgrade-backfill-course'
      AND content_text IS NULL AND external_url IS NULL
      AND updated_at='2026-01-02T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'UPGRADE_BACKFILL_REGRESSION: an authorial NULL was overwritten';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.course_lesson_content
    WHERE lesson_id='upgrade-authoritative' AND course_id='upgrade-backfill-course'
      AND content_text='CURRENT_PRIVATE_FIXTURE'
      AND external_url='https://example.invalid/current'
      AND updated_at='2026-01-02T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'UPGRADE_BACKFILL_REGRESSION: authoritative private content was overwritten';
  END IF;
  IF (SELECT count(*) FROM public.course_lesson_content WHERE course_id='upgrade-backfill-course')<>3 THEN
    RAISE EXCEPTION 'UPGRADE_BACKFILL_REGRESSION: private lesson rows were lost or duplicated';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.courses WHERE id='upgrade-backfill-course' AND modules='[
      {"id":"upgrade-module-a","title":"Module A","lessons":[
        {"id":"upgrade-legacy","title":"Legacy lesson","type":"text","description":"Keep this public description."},
        {"id":"upgrade-cleared","title":"Cleared lesson","type":"text"}
      ]},
      {"id":"upgrade-module-b","title":"Module B","lessons":[
        {"id":"upgrade-authoritative","title":"Current lesson","type":"text"}
      ]}
    ]'::jsonb
  ) THEN
    RAISE EXCEPTION 'UPGRADE_BACKFILL_REGRESSION: public curriculum leaked content or changed structure';
  END IF;
  IF NOT EXISTS (SELECT FROM public.community_posts WHERE id='upgrade-legacy-post' AND course_slug='upgrade-backfill-course'
      AND body='Historical question.' AND author_role='student')
     OR NOT EXISTS (SELECT FROM public.community_comments WHERE id='upgrade-legacy-comment' AND course_slug='upgrade-backfill-course'
      AND post_id='upgrade-legacy-post' AND body='Historical comment.' AND author_role='student')
     OR NOT EXISTS (SELECT FROM public.community_reports WHERE id='upgrade-legacy-report' AND course_slug='upgrade-backfill-course'
      AND post_id='upgrade-legacy-post' AND status='open') THEN
    RAISE EXCEPTION 'UPGRADE_COMMUNITY_REGRESSION: historical references or trusted author labels were not preserved';
  END IF;
END $$;

-- A FK remove o conteúdo privado deste curso. O perfil foi criado pelo
-- handle_new_user, como no seed existente; limpamos as duas linhas de usuário.
DELETE FROM public.community_reports WHERE id='upgrade-legacy-report';
DELETE FROM public.community_posts WHERE id='upgrade-legacy-post';
DELETE FROM public.courses WHERE id='upgrade-backfill-course';
DELETE FROM public.users WHERE uid='22222222-2222-4222-8222-222222222222';
DELETE FROM auth.users WHERE id='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.courses WHERE id='upgrade-backfill-course')
     OR EXISTS (SELECT FROM public.course_lesson_content WHERE course_id='upgrade-backfill-course')
     OR EXISTS (SELECT FROM public.community_posts WHERE id='upgrade-legacy-post')
     OR EXISTS (SELECT FROM public.community_comments WHERE id='upgrade-legacy-comment')
     OR EXISTS (SELECT FROM public.community_reports WHERE id='upgrade-legacy-report')
     OR EXISTS (SELECT FROM public.users WHERE uid='22222222-2222-4222-8222-222222222222')
     OR EXISTS (SELECT FROM auth.users WHERE id='22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'UPGRADE_FIXTURE_CLEANUP_FAILED';
  END IF;
END $$;
\echo Upgrade 0200: conteudo privado preservado, comunidade vinculada ao ID e fixtures removidas.

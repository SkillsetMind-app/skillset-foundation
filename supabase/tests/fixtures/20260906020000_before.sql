\set ON_ERROR_STOP on
-- Apenas build-test-db.sh: este arquivo, a migration 0200 e o after rodam
-- na MESMA transação do banco descartável. Não aplicar isolado nem em produção.
INSERT INTO auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-4222-8222-222222222222',
  'authenticated','authenticated','upgrade-backfill@example.invalid','',now(),
  now(),now(),'{"provider":"email","providers":["email"]}','{}'
);

INSERT INTO public.courses (
  id,owner_id,slug,title,summary,category,status,payment_type,price_amount_minor,
  currency,modules
) VALUES (
  'upgrade-backfill-course','22222222-2222-4222-8222-222222222222',
  'upgrade-backfill-slug','Upgrade backfill fixture',
  'Synthetic course for the disposable database upgrade proof.',
  'smoke','published','one_time',100,'USD',
  '[
    {"id":"upgrade-module-a","title":"Module A","lessons":[
      {"id":"upgrade-legacy","title":"Legacy lesson","type":"text","description":"Keep this public description.","contentText":"LEGACY_PRIVATE_FIXTURE","externalUrl":"https://example.invalid/legacy"},
      {"id":"upgrade-cleared","title":"Cleared lesson","type":"text","contentText":"STALE_DELETED_FIXTURE","externalUrl":"https://example.invalid/deleted"}
    ]},
    {"id":"upgrade-module-b","title":"Module B","lessons":[
      {"id":"upgrade-authoritative","title":"Current lesson","type":"text","contentText":"STALE_REPLACED_FIXTURE","externalUrl":"https://example.invalid/stale"}
    ]}
  ]'
);

-- NULL é uma decisão autoral, não ausência de migração. A linha já existe e
-- resolveLessonContent a prefere ao inline, inclusive quando ambos são NULL.
INSERT INTO public.course_lesson_content (
  lesson_id,course_id,content_text,external_url,created_at,updated_at
) VALUES
  ('upgrade-cleared','upgrade-backfill-course',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),
  ('upgrade-authoritative','upgrade-backfill-course','CURRENT_PRIVATE_FIXTURE',
   'https://example.invalid/current','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');

-- Historical rows really contain a slug different from the course ID. The
-- post/comment/report must remain attached to this course after its rename.
INSERT INTO public.community_posts(id,course_slug,author_id,author_name,author_role,category,body)
VALUES('upgrade-legacy-post','upgrade-backfill-slug','22222222-2222-4222-8222-222222222222',
  'Synthetic author','teacher','question','Historical question.');
INSERT INTO public.community_comments(id,post_id,course_slug,author_id,author_name,author_role,body)
VALUES('upgrade-legacy-comment','upgrade-legacy-post','upgrade-backfill-slug','22222222-2222-4222-8222-222222222222',
  'Synthetic author','admin','Historical comment.');
INSERT INTO public.community_reports(id,course_slug,post_id,target_type,reporter_id,reason,status)
VALUES('upgrade-legacy-report','upgrade-backfill-slug','upgrade-legacy-post','post',
  '22222222-2222-4222-8222-222222222222','spam','open');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM public.courses WHERE id='upgrade-backfill-course'
      AND modules->0->'lessons'->0->>'contentText'='LEGACY_PRIVATE_FIXTURE'
  ) OR EXISTS (
    SELECT FROM public.course_lesson_content WHERE lesson_id='upgrade-legacy'
  ) THEN
    RAISE EXCEPTION 'UPGRADE_FIXTURE_INVALID: legacy state was not established';
  END IF;
  IF NOT EXISTS (SELECT FROM public.community_posts WHERE id='upgrade-legacy-post' AND course_slug='upgrade-backfill-slug') THEN
    RAISE EXCEPTION 'UPGRADE_FIXTURE_INVALID: historical community slug was not established';
  END IF;
END $$;

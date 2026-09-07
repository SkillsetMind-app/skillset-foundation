\set ON_ERROR_STOP on
-- Only the disposable database: seed persisted legacy data before attempting
-- the migration, so another connection can prove its rollback preserves it.
\ir 20260906020000_before.sql
SELECT set_config('skillset_smoke.backfill_case', :'backfill_case', true);
DO $$
DECLARE v_case text:=current_setting('skillset_smoke.backfill_case');
BEGIN
  IF v_case IN ('duplicate_courses','duplicate_public_reference') THEN
    INSERT INTO public.courses(id,owner_id,slug,title,summary,category,status,payment_type,price_amount_minor,currency,modules)
    VALUES('upgrade-backfill-conflict','22222222-2222-4222-8222-222222222222',
      'upgrade-backfill-conflict','Conflicting legacy fixture','Synthetic legacy source.','smoke','published','one_time',100,'USD',
      '[{"id":"conflict-module","lessons":[{"id":"upgrade-legacy","contentText":"CONFLICT_PRIVATE_FIXTURE","externalUrl":"https://example.invalid/conflict"}]}]');
    IF v_case='duplicate_public_reference' THEN
      UPDATE public.courses SET modules=modules#-'{0,lessons,0,contentText}'#-'{0,lessons,0,externalUrl}'
      WHERE id='upgrade-backfill-conflict';
    END IF;
  ELSIF v_case='duplicate_same_course' THEN
    UPDATE public.courses SET modules=jsonb_set(modules,'{1,lessons}',
      (modules#>'{1,lessons}')||'[{"id":"upgrade-legacy","contentText":"CONFLICT_PRIVATE_FIXTURE"}]'::jsonb)
    WHERE id='upgrade-backfill-course';
  ELSIF v_case='missing_id' THEN
    UPDATE public.courses SET modules=modules#-'{0,lessons,0,id}' WHERE id='upgrade-backfill-course';
  ELSIF v_case IN ('null_id','empty_id','whitespace_id','nonstring_id') THEN
    UPDATE public.courses SET modules=jsonb_set(modules,'{0,lessons,0,id}',
      CASE v_case WHEN 'null_id' THEN 'null'::jsonb WHEN 'empty_id' THEN '""'::jsonb
        WHEN 'whitespace_id' THEN '" \t "'::jsonb ELSE '42'::jsonb END)
    WHERE id='upgrade-backfill-course';
  ELSE
    RAISE EXCEPTION 'UPGRADE_FIXTURE_INVALID: unknown unsafe backfill case';
  END IF;
END $$;

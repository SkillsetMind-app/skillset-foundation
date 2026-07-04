-- Applied to prod 2026-07-04 via Supabase MCP (apply_migration), mirrored here
-- for versioning/audit. Two hardening changes:
--
-- 1. SELECT policies for paid course content were enrollment-status-blind: a
--    refunded/revoked/expired learner could still read course_assets rows
--    (storage_path/download_url) and mint 1h signed URLs from the private
--    course-content bucket. Tightened to active/completed only — matching the
--    app-layer predicate canViewCourseAssetVideo (src/domain/course-asset.ts).
--
-- 2. SECURITY DEFINER RPCs that only make sense signed-in were executable by
--    `anon` via /rest/v1/rpc (default PUBLIC grant). Revoked PUBLIC+anon and
--    re-granted explicitly. Deliberately KEPT for anon: enforce_rate_limit
--    (pre-signup pwned-check), verify_skillset_certificate (public page), and
--    the is_* / is_target_author helpers (evaluated inside RLS policies as the
--    querying role — revoking anon would break public marketplace reads).
--    Trigger functions (handle_new_user, notify_enrolled_on_course_event) left
--    untouched: they return type `trigger`, PostgREST cannot invoke them.

alter policy course_assets_select on public.course_assets
using (
  is_admin()
  or exists (
    select 1 from public.courses c
    where c.id = course_assets.course_id
      and c.owner_id = (select auth.uid())::text
  )
  or exists (
    select 1 from public.enrollments e
    where e.course_id = course_assets.course_id
      and e.user_id = (select auth.uid())::text
      and e.status in ('active', 'completed')
  )
);

alter policy course_content_select on storage.objects
using (
  bucket_id = 'course-content'
  and (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = (storage.foldername(objects.name))[2]
        and c.owner_id = (select auth.uid())::text
    )
    or exists (
      select 1 from public.enrollments e
      where e.course_id = (storage.foldername(objects.name))[2]
        and e.user_id = (select auth.uid())::text
        and e.status in ('active', 'completed')
    )
  )
);

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_free_course_enrollment',
    'create_teacher_course_draft',
    'update_teacher_course_builder',
    'submit_teacher_course_for_review',
    'delete_teacher_course_draft',
    'delete_course_as_admin',
    'send_course_message',
    'request_account_action',
    'log_audit_event',
    'has_enrollment_for_course_slug'
  ] loop
    execute (
      select string_agg(format(
        'revoke execute on function %1$s from public, anon;
         grant execute on function %1$s to authenticated, service_role;',
        p.oid::regprocedure), ' ')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    );
  end loop;

  -- Cron-only recompute: nobody should trigger it via the API (free compute
  -- burn). pg_cron runs it as the job owner, unaffected by these grants.
  execute (
    select string_agg(format(
      'revoke execute on function %1$s from public, anon, authenticated;
       grant execute on function %1$s to service_role;',
      p.oid::regprocedure), ' ')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recompute_course_trending_scores'
  );
end $$;

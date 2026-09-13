\set ON_ERROR_STOP on
begin;

-- Supplemental catalog guard. Concurrent behavioral proofs require separate
-- transactions; this check keeps their two lock boundaries in every DB build.
do $smoke$
declare progress text; featured text;
begin
  select prosrc into strict progress from pg_proc
    where oid = 'public.record_lesson_progress(text,text,boolean)'::regprocedure;
  select prosrc into strict featured from pg_proc
    where oid = 'public.set_own_course_featured(text,boolean)'::regprocedure;
  if progress !~* 'from public[.]enrollments[[:space:]]+where id = v_enrollment_id[[:space:]]+for update;'
    or position('for update;' in progress) > position('v_enrollment.status in' in progress) then
    raise exception 'RPC_CONCURRENCY_REGRESSION: progress must lock enrollment before checking its status';
  end if;
  if featured !~* 'perform 1 from public[.]users where uid = v_uid for update;'
    or position('perform 1 from public.users' in featured) > position('select status, featured' in featured) then
    raise exception 'RPC_CONCURRENCY_REGRESSION: feature quota must lock owner before course';
  end if;
  if position('public.require_strong_session()' in progress) = 0
    or position('public.require_strong_session()' in featured) = 0
    or not has_function_privilege('authenticated', 'public.record_lesson_progress(text,text,boolean)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_own_course_featured(text,boolean)', 'EXECUTE') then
    raise exception 'RPC_CONCURRENCY_REGRESSION: session guard or legitimate RPC access changed';
  end if;
end $smoke$;

rollback;

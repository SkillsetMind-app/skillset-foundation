-- Preserve signatures, ACLs, MFA and business rules. Lock the row that owns
-- each invariant before reading it: enrollment status, and per-owner quota.
do $migration$
declare
  target record;
  f record;
  next_body text;
begin
  for target in select * from (values
    ('public.record_lesson_progress(text,text,boolean)',
     '(from public[.]enrollments[[:space:]]+where id = v_enrollment_id);',
     E'\\1 for update;'),
    ('public.set_own_course_featured(text,boolean)',
     '(select status, featured into v_status, v_already)',
     E'perform 1 from public.users where uid = v_uid for update;\n\n  \\1')
  ) as changes(signature, pattern, replacement)
  loop
    select prosrc, pg_get_functiondef(oid) as definition into strict f
    from pg_proc where oid = target.signature::regprocedure;
    if (select count(*) from regexp_matches(f.prosrc, target.pattern, 'g')) <> 1
      or position('public.require_strong_session()' in f.prosrc) = 0 then
      raise exception 'RPC concurrency guard anchor changed: %', target.signature;
    end if;
    next_body := regexp_replace(f.prosrc, target.pattern, target.replacement);
    execute replace(f.definition, f.prosrc, next_body);
  end loop;
end $migration$;

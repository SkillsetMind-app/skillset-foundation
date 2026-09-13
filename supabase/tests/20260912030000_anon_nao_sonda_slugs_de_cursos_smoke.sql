begin;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.course_title_key_available(text,text)',
    'EXECUTE'
  ) then
    raise exception 'SLUG_PRIVILEGE_REGRESSION: anonymous probe is exposed';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.course_title_key_available(text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.course_title_key_available(text,text)',
    'EXECUTE'
  ) then
    raise exception 'SLUG_PRIVILEGE_REGRESSION: intended callers are blocked';
  end if;
end $$;

set local role authenticated;
select public.course_title_key_available('security-smoke-course-title', null);
reset role;

rollback;

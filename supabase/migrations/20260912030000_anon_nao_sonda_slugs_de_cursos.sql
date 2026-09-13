-- A funcao escolhe a proxima URL livre consultando todos os cursos como
-- SECURITY DEFINER. Visitantes nao precisam chama-la diretamente: somente as
-- RPCs autenticadas de criacao e edicao de curso usam esse helper.
revoke all privileges on function public.course_title_key_available(text, text)
  from public, anon;
grant execute on function public.course_title_key_available(text, text)
  to authenticated, service_role;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.course_title_key_available(text,text)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY_REGRESSION: anon can probe course title keys';
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
    raise exception 'SECURITY_REGRESSION: intended course title callers lost access';
  end if;
end $$;

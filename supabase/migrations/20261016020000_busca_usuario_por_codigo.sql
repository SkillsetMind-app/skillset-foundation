-- A busca de Operacoes acha a conta pelo codigo da marca d'agua ("4F3A-92C1",
-- os 8 primeiros caracteres do uid). Mesma assinatura, mesmo portao (admin
-- ativo com aal2) e mesmas permissoes de 20260911010000; muda so o filtro.
-- So o codigo inteiro casa: um pedaco de uid nao lista contas.

create or replace function public.admin_search_users(
  p_search text default null,
  p_status text default null,
  p_role text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  uid text,
  email text,
  display_name text,
  roles jsonb,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  suspended boolean,
  blocked boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  -- "4F3A-92C1" ou "4f3a92c1" -> "4f3a92c1". So hex, entao nao ha curinga do like.
  v_code text := case when v_search ~* '^[0-9a-f]{4}-?[0-9a-f]{4}$'
    then lower(replace(v_search, '-', '')) end;
begin
  if auth.uid() is null or not public.is_admin()
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'OPS_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  if (p_status is not null and p_status not in ('active', 'suspended', 'blocked'))
    or (p_role is not null and p_role not in ('student', 'teacher', 'admin', 'support', 'moderator', 'ops')) then
    raise exception 'USER_SEARCH_INVALID_FILTER' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select u.uid, u.email, u.display_name,
      coalesce(u.roles, '[]'::jsonb) as roles,
      u.created_at, a.last_sign_in_at,
      coalesce(c.suspended, false) as suspended,
      c.blocked_email is not null as blocked
    from public.users u
    left join auth.users a on a.id::text = u.uid
    left join public.account_controls c on c.uid = u.uid
    where (v_search is null
        or u.email ilike '%' || v_search || '%'
        or u.display_name ilike '%' || v_search || '%'
        or u.uid = v_search
        or (v_code is not null and u.uid like v_code || '%'))
      and (p_role is null or coalesce(u.roles, '[]'::jsonb) ? p_role)
  )
  select f.uid, f.email, f.display_name, f.roles, f.created_at, f.last_sign_in_at,
    f.suspended, f.blocked, count(*) over ()
  from filtered f
  where p_status is null
    or (p_status = 'active' and not f.suspended)
    or (p_status = 'suspended' and f.suspended and not f.blocked)
    or (p_status = 'blocked' and f.blocked)
  order by f.created_at desc nulls last, f.uid
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;
revoke all on function public.admin_search_users(text, text, text, int, int) from public, anon, service_role;
grant execute on function public.admin_search_users(text, text, text, int, int) to authenticated;

-- Preserve the RPC's text contract; users.created_at is timestamptz.
-- CREATE OR REPLACE retains ownership and execute grants. Keep the MFA gate.
create or replace function public.admin_list_platform_users(
  p_search text default null,
  p_limit int default 200
)
returns table (
  uid text,
  email text,
  display_name text,
  roles jsonb,
  creator_verification_status text,
  created_at text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_strong_session();
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  return query
  select
    u.uid,
    u.email,
    u.display_name,
    coalesce(u.roles, '[]'::jsonb) as roles,
    u.creator_verification_status,
    u.created_at::text
  from public.users u
  where u.uid is not null
    and (
      v_search is null
      or u.email ilike '%' || v_search || '%'
      or u.display_name ilike '%' || v_search || '%'
    )
  order by u.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$;

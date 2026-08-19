-- Admin role management.
--
-- The seven roles and the full permission matrix have existed in TypeScript
-- since the permissions module landed, but nothing could ever ASSIGN one: the
-- only way to make someone an admin, a moderator or support was to edit
-- public.users by hand. These two functions close that gap from the database
-- side, so the gate lives next to the data instead of in a route that could be
-- bypassed.
--
-- Both are SECURITY DEFINER and gate on is_admin(), the same predicate the
-- refunds route and the teacher RPCs already trust.

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
    u.created_at
  from public.users u
  where u.uid is not null
    and (
      v_search is null
      -- Case-insensitive on both columns: Postgres ~ is case-SENSITIVE, and a
      -- roster search that misses "Patrick" because the row says "patrick" is
      -- worse than useless.
      or u.email ilike '%' || v_search || '%'
      or u.display_name ilike '%' || v_search || '%'
    )
  order by u.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$;

create or replace function public.admin_set_user_roles(
  p_target_uid text,
  p_roles jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller_uid text := (select auth.uid())::text;
  v_caller_email text;
  v_target_uid text := nullif(btrim(coalesce(p_target_uid, '')), '');
  v_previous jsonb;
  v_next jsonb;
  v_admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  if v_target_uid is null then
    raise exception 'A target user is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_roles) is distinct from 'array' then
    raise exception 'Roles must be a JSON array.' using errcode = '22023';
  end if;

  -- Whitelist. All seven live here even though the console only offers five
  -- today, so splitting support/moderator/ops apart later needs no migration.
  if exists (
    select 1
    from jsonb_array_elements_text(p_roles) as candidate(role)
    where candidate.role not in (
      'guest', 'student', 'teacher', 'admin', 'support', 'moderator', 'ops'
    )
  ) then
    raise exception 'Unknown role in the requested set.' using errcode = '22023';
  end if;

  -- Deduplicate and drop nulls so the stored array stays canonical however the
  -- caller assembled it.
  select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
    into v_next
  from jsonb_array_elements_text(p_roles) as t(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(u.roles, '[]'::jsonb) into v_previous
  from public.users u
  where u.uid = v_target_uid;

  if not found then
    raise exception 'That user does not exist.' using errcode = '23503';
  end if;

  -- Self-lockout guard. An admin who demotes themselves loses the console that
  -- would let them undo it, and the only way back would be editing the table by
  -- hand — exactly the situation these functions exist to end.
  if v_target_uid = v_caller_uid and not (v_next ? 'admin') then
    raise exception 'You cannot remove your own admin role.' using errcode = '42501';
  end if;

  -- Last-admin guard. Separate from the rule above: one admin demoting ANOTHER
  -- admin is legitimate, unless it empties the set and locks everyone out.
  if (v_previous ? 'admin') and not (v_next ? 'admin') then
    select count(*) into v_admin_count
    from public.users u
    where coalesce(u.roles, '[]'::jsonb) ? 'admin';

    if v_admin_count <= 1 then
      raise exception 'The platform must keep at least one administrator.'
        using errcode = '42501';
    end if;
  end if;

  if v_previous = v_next then
    return v_next;
  end if;

  update public.users
  set roles = v_next, updated_at = now()
  where uid = v_target_uid;

  select u.email into v_caller_email
  from public.users u
  where u.uid = v_caller_uid;

  perform public.log_audit_event(
    'user.roles_changed',
    v_caller_uid,
    v_caller_email,
    'user',
    v_target_uid,
    'Roles changed from ' || v_previous::text || ' to ' || v_next::text,
    jsonb_build_object('previous', v_previous, 'next', v_next)
  );

  return v_next;
end;
$function$;

revoke execute on function public.admin_list_platform_users(text, int) from public, anon;
grant execute on function public.admin_list_platform_users(text, int) to authenticated, service_role;

revoke execute on function public.admin_set_user_roles(text, jsonb) from public, anon;
grant execute on function public.admin_set_user_roles(text, jsonb) to authenticated, service_role;

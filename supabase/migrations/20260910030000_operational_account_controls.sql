-- Operational restrictions are independent of roles, billing and profile data.
-- No FK: a blocked address must survive a future, separately authorized deletion.
create table public.account_controls (
  uid text primary key,
  suspended boolean not null,
  blocked_email text unique,
  sessions_revoked_before timestamptz not null,
  check (blocked_email is null or (suspended and blocked_email = lower(btrim(blocked_email))
    and length(blocked_email) between 3 and 254))
);
alter table public.account_controls enable row level security;
revoke all on public.account_controls from public, anon, authenticated, service_role;

-- No JWT metadata/profile claims: status is live, session creation is Auth-owned.
-- Unaffected accounts retain their existing session contract. Anonymous public
-- reads stay public. Restoring an account never resurrects its old sessions.
create function public.account_session_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select not exists (
    select 1 from public.account_controls c
    where c.uid = auth.uid()::text and (
      c.suspended or not exists (
        select 1 from auth.sessions s where s.user_id = auth.uid()
          and s.id::text = auth.jwt()->>'session_id'
          and s.created_at > c.sessions_revoked_before
      )
    )
  );
$function$;
revoke all on function public.account_session_allowed() from public;
grant execute on function public.account_session_allowed() to anon, authenticated, service_role;

create or replace function public.session_is_strong() returns boolean
language sql stable security definer set search_path = public, auth, pg_temp as $function$
  select public.account_session_allowed() and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified')
  );
$function$;

-- Restrictive policies AND with every existing permissive policy, including
-- owner/admin shortcuts. SECURITY DEFINER RPCs instead use session_is_strong.
do $guard$
declare t record;
begin
  for t in select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('create policy account_access_guard on %I.%I as restrictive for all to authenticated
      using ((select public.account_session_allowed()))
      with check ((select public.account_session_allowed()))', t.nspname, t.relname);
  end loop;
end $guard$;

-- Existing role predicates are also called inside SECURITY DEFINER RPCs.
-- Preserve their role logic and grants, but suspended/revoked sessions have no
-- operational role. This does not mask auth.uid() or change persisted roles.
do $guard$
declare f record; body text;
begin
  for f in select p.oid, p.prosrc, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('is_admin','is_teacher','is_support','is_moderator','is_ops','is_target_author')
  loop
    body := regexp_replace(f.prosrc, '(^[[:space:]]*select)[[:space:]]',
      E'\\1 public.account_session_allowed() AND ', 'i');
    if body = f.prosrc then raise exception 'Account role guard could not be installed'; end if;
    execute replace(f.definition, f.prosrc, body);
  end loop;
end $guard$;

-- Course-commerce RPCs call this owner helper from their DECLARE block, before
-- any ordinary BEGIN guard. Close that shared boundary as well.
do $guard$
declare f text := pg_get_functiondef('public.assert_course_owner(text)'::regprocedure); body text;
begin
  body := regexp_replace(f, '(^|\n)([[:space:]]*)begin([[:space:]]|$)',
    E'\\1\\2BEGIN\n  PERFORM public.require_strong_session();\\3', 'i');
  if body = f then raise exception 'Account owner guard could not be installed'; end if;
  execute body;
end $guard$;

-- Role downgrades must count usable administrators, and serialize the check
-- with suspension/other role writes. Keep all existing validation and audit.
do $guard$
declare f text := pg_get_functiondef('public.admin_set_user_roles(text,jsonb)'::regprocedure); body text;
begin
  body := replace(f, 'where coalesce(u.roles, ''[]''::jsonb) ? ''admin'';',
    'where coalesce(u.roles, ''[]''::jsonb) ? ''admin''
      and not exists (select 1 from public.account_controls c where c.uid = u.uid and c.suspended);');
  if body = f then raise exception 'Active administrator count could not be installed'; end if;
  f := body;
  body := regexp_replace(f, '(^|\n)([[:space:]]*)begin([[:space:]]|$)',
    E'\\1\\2BEGIN\n  LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;\\3', 'i');
  if body = f then raise exception 'Administrator role lock could not be installed'; end if;
  execute body;
end $guard$;

-- auth.users is the common boundary for password, OTP, OAuth and admin-created
-- accounts. Do not modify handle_new_user or provider/email configuration.
create function public.guard_blocked_account_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then return new; end if;
  if exists (select 1 from public.account_controls c
    where c.blocked_email = lower(btrim(new.email)))
    or (tg_op = 'UPDATE' and exists (select 1 from public.account_controls c
      where c.uid = new.id::text and c.suspended)) then
    raise exception 'Account registration is unavailable.' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_blocked_account_email() from public, anon, authenticated, service_role;
create trigger account_email_guard before insert or update of email on auth.users
  for each row execute function public.guard_blocked_account_email();

create function public.admin_set_account_control(p_target_uid text, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_before public.account_controls;
  v_after public.account_controls;
  v_email text;
  v_roles jsonb;
  v_actor text := auth.uid()::text;
begin
  if v_actor is null or not public.is_admin()
    or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('suspend','block','restore')
    or nullif(btrim(p_target_uid), '') is null
    or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'ACCOUNT_CONTROL_INVALID_INPUT' using errcode = '22023';
  end if;
  -- ponytail: table locks serialize rare operations with signup and role writes;
  -- use a shared row-lock protocol if operational volume makes this measurable.
  lock table auth.users, public.users in share row exclusive mode;
  -- A concurrent role change/suspension may have won while this request waited.
  if not public.is_admin() then
    raise exception 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  select lower(btrim(a.email)), u.roles into v_email, v_roles
    from auth.users a join public.users u on u.uid = a.id::text
    where u.uid = p_target_uid;
  if not found then raise exception 'ACCOUNT_CONTROL_USER_MISSING' using errcode = '23503'; end if;
  if p_action <> 'restore' and v_roles ? 'admin' and not exists (
    select 1 from public.users u where u.uid <> p_target_uid and u.roles ? 'admin'
      and not exists (select 1 from public.account_controls c where c.uid = u.uid and c.suspended)
  ) then
    raise exception 'ACCOUNT_CONTROL_LAST_ADMIN' using errcode = '42501';
  end if;
  if p_target_uid = v_actor then
    raise exception 'ACCOUNT_CONTROL_SELF' using errcode = '42501';
  end if;
  if p_action = 'block' and (v_email is null or length(v_email) not between 3 and 254) then
    raise exception 'ACCOUNT_CONTROL_EMAIL_MISSING' using errcode = '22023';
  end if;
  -- Refuse ambiguous legacy duplicate Auth addresses rather than suspend an
  -- unintended second account (possibly the acting/last administrator).
  if p_action = 'block' and exists (select 1 from auth.users a
    where lower(btrim(a.email)) = v_email and a.id::text <> p_target_uid) then
    raise exception 'ACCOUNT_CONTROL_EMAIL_CONFLICT' using errcode = '22023';
  end if;
  select * into v_before from public.account_controls where uid = p_target_uid;
  if (p_action = 'restore' and not coalesce(v_before.suspended, false))
    or (p_action = 'suspend' and v_before.suspended)
    or (p_action = 'block' and v_before.suspended and v_before.blocked_email = v_email) then
    return coalesce(to_jsonb(v_before), jsonb_build_object('uid', p_target_uid,
      'suspended', false, 'blocked_email', null));
  end if;
  insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before)
    values (p_target_uid, p_action <> 'restore',
      case when p_action = 'block' then v_email
        when p_action = 'suspend' then v_before.blocked_email end, clock_timestamp())
    on conflict (uid) do update set suspended = excluded.suspended,
      blocked_email = excluded.blocked_email, sessions_revoked_before = excluded.sessions_revoked_before
    returning * into v_after;
  -- The legacy log_audit_event catches errors. This insert MUST abort everything
  -- on failure. No names, role mutation, billing mutation or destructive delete.
  insert into public.audit_log(id, action, actor_id, actor_email, target_type, target_id, summary, metadata, created_at)
    values (gen_random_uuid()::text, 'user.account_' || p_action, v_actor,
      (select email from auth.users where id = auth.uid()), 'user', p_target_uid,
      'user.account_' || p_action,
      jsonb_build_object('reason', btrim(p_reason), 'previous', to_jsonb(v_before), 'next', to_jsonb(v_after)),
      clock_timestamp());
  return to_jsonb(v_after);
end;
$function$;
revoke all on function public.admin_set_account_control(text,text,text) from public, anon, service_role;
grant execute on function public.admin_set_account_control(text,text,text) to authenticated;

-- Separate read preserves the deployed roster RPC's return signature.
create function public.admin_get_account_control(p_target_uid text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if auth.uid() is null or not public.is_admin() or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where uid = p_target_uid) then
    raise exception 'ACCOUNT_CONTROL_USER_MISSING' using errcode = '23503';
  end if;
  return coalesce((select to_jsonb(c) from public.account_controls c where uid = p_target_uid),
    jsonb_build_object('uid', p_target_uid, 'suspended', false, 'blocked_email', null))
    || jsonb_build_object('is_self', p_target_uid = auth.uid()::text);
end;
$function$;
revoke all on function public.admin_get_account_control(text) from public, anon, service_role;
grant execute on function public.admin_get_account_control(text) to authenticated;

-- Explicit platform access, never course enrollment or legal/professional approval.
-- Replace the effective 20260731000100 guard, keeping its server-field checks.
-- Onboarding sends only student/teacher; merge privileged roles from the locked
-- OLD row before the admin early return, so even admin onboarding cannot demote.
create or replace function public.users_field_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trusted boolean := public.is_service_role()
    or coalesce(current_setting('skillset.trusted_write', true) = 'on', false);
  v_previous_privileged jsonb;
  v_next_privileged jsonb;
begin
  if tg_op = 'UPDATE' and new.roles is distinct from old.roles then
    if jsonb_typeof(new.roles) is distinct from 'array' then
      raise exception 'Roles must be a JSON array.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(new.roles) r(value)
      where jsonb_typeof(value) <> 'string') then
      raise exception 'Roles must be strings.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      into v_previous_privileged from jsonb_array_elements(coalesce(old.roles, '[]'::jsonb)) r(value)
      where value not in ('"student"'::jsonb, '"teacher"'::jsonb);
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      into v_next_privileged from jsonb_array_elements(new.roles) r(value)
      where value not in ('"student"'::jsonb, '"teacher"'::jsonb);
    if old.uid = auth.uid()::text then
      if v_next_privileged = '[]'::jsonb then
        select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
          into new.roles from jsonb_array_elements(new.roles || v_previous_privileged) r(value);
        v_next_privileged := v_previous_privileged;
      end if;
      if not v_trusted and v_next_privileged is distinct from v_previous_privileged then
        raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_trusted or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if jsonb_typeof(coalesce(new.roles, '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Roles must be a JSON array.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(new.roles, '[]'::jsonb)) r(value)
      where value not in ('"student"'::jsonb, '"teacher"'::jsonb)) then
      raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
    end if;
    if coalesce(new.creator_verification_status, 'none') <> 'none'
       or new.activation_fee_paid_at is not null then
      raise exception 'users: creator gate fields are server-controlled';
    end if;
    return new;
  end if;

  if new.roles is distinct from old.roles
     and v_next_privileged is distinct from v_previous_privileged then
    raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
  end if;

  if new.stripe_connected_account_id       is distinct from old.stripe_connected_account_id
     or new.stripe_connect_status          is distinct from old.stripe_connect_status
     or new.stripe_connect_charges_enabled is distinct from old.stripe_connect_charges_enabled
     or new.stripe_connect_payouts_enabled is distinct from old.stripe_connect_payouts_enabled
     or new.stripe_connect_updated_at      is distinct from old.stripe_connect_updated_at
     or new.stripe_customer_id             is distinct from old.stripe_customer_id
     or new.current_plan_id                is distinct from old.current_plan_id then
    raise exception 'users: Stripe/billing/plan fields are server-controlled';
  end if;

  if new.creator_verification_status is distinct from old.creator_verification_status
     or new.activation_fee_paid_at is distinct from old.activation_fee_paid_at then
    raise exception 'users: creator gate fields are server-controlled';
  end if;
  return new;
end $$;
revoke all on function public.users_field_guard() from public, anon, authenticated;

create table public.platform_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  access_level text not null check (access_level in ('student', 'teacher', 'staff', 'admin')),
  waive_activation boolean not null default false,
  created_by text not null references public.users(uid),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by text references public.users(uid),
  accepted_waiver_revision uuid,
  accepted_result jsonb,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (not waive_activation or access_level = 'teacher'),
  check ((accepted_at is null) = (accepted_by is null)),
  check ((accepted_at is null) = (accepted_result is null)),
  check (accepted_result is null or jsonb_typeof(accepted_result) = 'object'),
  check ((accepted_waiver_revision is not null) = (accepted_at is not null and waive_activation)),
  check (accepted_at is null or revoked_at is null)
);
-- Expired rows remain pending until an explicit create revokes/replaces them.
create unique index platform_invites_pending_email on public.platform_invites(email)
  where accepted_at is null and revoked_at is null;
create index platform_invites_created_by on public.platform_invites(created_by);
create index platform_invites_accepted_by on public.platform_invites(accepted_by);

create table public.creator_activation_waivers (
  uid text primary key references public.users(uid),
  granted_by text not null references public.users(uid),
  granted_at timestamptz not null default clock_timestamp(),
  revision uuid not null default gen_random_uuid(),
  ready_at timestamptz
);
create index creator_activation_waivers_granted_by on public.creator_activation_waivers(granted_by);
alter table public.platform_invites enable row level security;
alter table public.creator_activation_waivers enable row level security;
revoke all on public.platform_invites, public.creator_activation_waivers from public, anon, authenticated;

-- Immutable acceptance facts plus current status of exactly that grant revision.
-- A later admin revoke/regrant wins; an old invite must not finalize a new grant.
create function public.platform_invite_acceptance_result(p_invite public.platform_invites) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select (p_invite).accepted_result || jsonb_build_object(
    'waive_activation', w.uid is not null,
    'waiver_revision', w.revision,
    'activation_pending', w.uid is not null and w.ready_at is null)
  from (values (1)) as singleton(n)
  left join public.creator_activation_waivers w on w.uid = (p_invite).accepted_by
    and w.revision = (p_invite).accepted_waiver_revision;
$$;
revoke all on function public.platform_invite_acceptance_result(public.platform_invites)
  from public, anon, authenticated, service_role;

-- The existing log_audit_event swallows failures. Access changes must fail closed.
create function public.audit_platform_access_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_action text;
begin
  if tg_table_name = 'platform_invites' then
    if tg_op <> 'INSERT' and old.accepted_at is not null then
      raise exception 'Accepted invitations are immutable.' using errcode = '42501';
    end if;
    v_action := case when tg_op = 'INSERT' then 'platform_invite.created'
      when tg_op = 'DELETE' then 'platform_invite.deleted'
      when new.accepted_at is not null then 'platform_invite.accepted'
      when new.revoked_at is not null then 'platform_invite.revoked'
      else 'platform_invite.updated' end;
  else
    v_action := case when tg_op = 'DELETE' then 'creator_activation_waiver.revoked'
      when tg_op = 'UPDATE' and new.ready_at is not null then 'creator_activation_waiver.ready'
      else 'creator_activation_waiver.granted' end;
  end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log(id, action, actor_id, actor_email, target_type, target_id,
    summary, metadata, created_at)
  values (gen_random_uuid()::text, v_action, auth.uid()::text,
    (select email from auth.users where id = auth.uid()), tg_table_name,
    coalesce(v_row->>'id', v_row->>'uid'), v_action,
    jsonb_build_object('previous', case when tg_op <> 'INSERT' then to_jsonb(old) end,
      'next', case when tg_op <> 'DELETE' then to_jsonb(new) end), clock_timestamp());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.audit_platform_access_change() from public, anon, authenticated;
-- AFTER logs the actual upsert outcome, not the speculative INSERT on conflict.
create trigger platform_invites_audit_aiud after insert or update or delete on public.platform_invites
  for each row execute function public.audit_platform_access_change();
create trigger creator_activation_waivers_audit_aiud after insert or update or delete on public.creator_activation_waivers
  for each row execute function public.audit_platform_access_change();

create function public.admin_create_platform_invite(
  p_email text, p_access_level text, p_waive_activation boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_invite public.platform_invites;
begin
  perform public.require_strong_session();
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  if v_email is null or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_access_level is null or p_access_level not in ('student','teacher','staff','admin')
     or p_waive_activation is null
     or (p_waive_activation and p_access_level <> 'teacher') then
    raise exception 'Invalid invitation.' using errcode = '22023';
  end if;
  -- Same lock/order for create, revoke and accept. The unique index is the backstop.
  perform pg_advisory_xact_lock(hashtextextended('platform_invite:' || v_email, 0));
  perform 1 from public.users where uid = auth.uid()::text for share;
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  update public.platform_invites set revoked_at = clock_timestamp()
    where email = v_email and accepted_at is null and revoked_at is null;
  insert into public.platform_invites(email, access_level, waive_activation, created_by)
    values (v_email, p_access_level, p_waive_activation, auth.uid()::text)
    returning * into v_invite;
  return to_jsonb(v_invite);
end $$;

create function public.admin_list_platform_invites() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_strong_session();
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc, i.id), '[]'::jsonb)
    from (select * from public.platform_invites order by created_at desc, id limit 200) i);
end $$;

create function public.admin_revoke_platform_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text; v_invite public.platform_invites;
begin
  perform public.require_strong_session();
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  select email into v_email from public.platform_invites where id = p_invite_id;
  if not found then raise exception 'Invitation unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_invite:' || v_email, 0));
  perform 1 from public.users where uid = auth.uid()::text for share;
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  select * into v_invite from public.platform_invites where id = p_invite_id for update;
  if v_invite.accepted_at is not null then
    raise exception 'Accepted invitations are immutable.' using errcode = '42501';
  end if;
  update public.platform_invites set revoked_at = clock_timestamp()
    where id = p_invite_id and revoked_at is null;
end $$;

create function public.get_my_platform_invite(p_invite_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform public.require_strong_session();
  select case when i.accepted_at is not null then public.platform_invite_acceptance_result(i)
    else (to_jsonb(i) - 'created_by' - 'accepted_by' - 'accepted_result' - 'accepted_waiver_revision')
      || jsonb_build_object('activation_pending', false) end into v_result
    from public.platform_invites i join auth.users a
      on a.id = auth.uid() and a.email_confirmed_at is not null
      and lower(btrim(a.email)) = i.email
    where i.id = p_invite_id and i.revoked_at is null
      and ((i.accepted_at is null and i.expires_at > statement_timestamp())
        or (i.accepted_at is not null and i.accepted_by = auth.uid()::text))
      and exists (select 1 from public.users u where u.uid = i.created_by and u.roles ? 'admin');
  if v_result is null then
    raise exception 'Invitation unavailable.' using errcode = '42501';
  end if;
  return v_result;
end $$;

create function public.accept_platform_invite(p_invite_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := auth.uid()::text;
  v_email text;
  v_auth_email text;
  v_issuer text;
  v_invite public.platform_invites;
  v_roles jsonb;
  v_add_roles jsonb;
  v_next_path text;
  v_revision uuid;
  v_result jsonb;
  v_trusted text := current_setting('skillset.trusted_write', true);
begin
  perform public.require_strong_session();
  if v_uid is null then raise exception 'Invitation unavailable.' using errcode = '42501'; end if;
  select email, created_by into v_email, v_issuer from public.platform_invites where id = p_invite_id;
  if not found then raise exception 'Invitation unavailable.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_invite:' || v_email, 0));
  -- Lock Auth's authoritative email and both profiles, not client-writable metadata.
  select lower(btrim(email)) into v_auth_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null for share;
  if v_auth_email is distinct from v_email then
    raise exception 'Invitation unavailable.' using errcode = '42501';
  end if;
  perform 1 from public.users where uid in (v_uid, v_issuer) order by uid for update;
  select * into v_invite from public.platform_invites where id = p_invite_id for update;
  if not found or v_invite.revoked_at is not null
     or not exists (select 1 from public.users where uid = v_issuer and roles ? 'admin') then
    raise exception 'Invitation unavailable.' using errcode = '42501';
  end if;
  -- Retry only returns the immutable receipt; never recreate a revoked/superseded
  -- waiver, reset onboarding, regrant roles, or write another acceptance audit.
  if v_invite.accepted_at is not null then
    if v_invite.accepted_by is distinct from v_uid then
      raise exception 'Invitation unavailable.' using errcode = '42501';
    end if;
    return public.platform_invite_acceptance_result(v_invite);
  end if;
  if v_invite.expires_at <= clock_timestamp() then
    raise exception 'Invitation unavailable.' using errcode = '42501';
  end if;
  select coalesce(roles, '[]'::jsonb) into v_roles from public.users where uid = v_uid;
  if not found then raise exception 'Account profile unavailable.' using errcode = '42501'; end if;
  v_add_roles := case v_invite.access_level
    when 'staff' then '["support","moderator","ops"]'::jsonb
    when 'admin' then '["admin"]'::jsonb else '["student"]'::jsonb end;
  select jsonb_agg(distinct value order by value) into v_roles
    from jsonb_array_elements(v_roles || v_add_roles);
  v_next_path := case v_invite.access_level when 'teacher' then '/onboarding?path=teacher'
    when 'student' then '/learn' else '/ops' end;
  perform set_config('skillset.trusted_write', 'on', true);
  update public.users set roles = v_roles,
    onboarding_path = case when v_invite.access_level = 'teacher' then 'teacher' else onboarding_path end,
    onboarding_completed = case when v_invite.access_level in ('admin','staff') then true
      when v_invite.access_level = 'teacher' then false else onboarding_completed end,
    updated_at = clock_timestamp()
    where uid = v_uid;
  perform set_config('skillset.trusted_write', coalesce(v_trusted, 'off'), true);
  if v_invite.waive_activation then
    insert into public.creator_activation_waivers(uid, granted_by)
      values (v_uid, v_issuer)
      on conflict (uid) do update set granted_by = excluded.granted_by, granted_at = clock_timestamp(),
        revision = excluded.revision, ready_at = null
      returning revision into v_revision;
  end if;
  v_invite.accepted_at := clock_timestamp();
  v_invite.accepted_by := v_uid;
  v_result := (to_jsonb(v_invite) - 'created_by' - 'accepted_by' - 'accepted_result' - 'accepted_waiver_revision')
    || jsonb_build_object('next_path', v_next_path, 'roles', v_roles,
      'waiver_revision', v_revision, 'activation_pending', v_revision is not null);
  update public.platform_invites set accepted_at = v_invite.accepted_at, accepted_by = v_uid,
    accepted_waiver_revision = v_revision, accepted_result = v_result where id = p_invite_id;
  return v_result;
end $$;

create function public.admin_set_activation_waiver(p_target_uid text, p_waived boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_revision uuid;
begin
  perform public.require_strong_session();
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  if p_waived is null or nullif(btrim(p_target_uid), '') is null then
    raise exception 'A target and waiver state are required.' using errcode = '22023';
  end if;
  perform 1 from public.users where uid in (auth.uid()::text, p_target_uid) order by uid for update;
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users where uid = p_target_uid) then
    raise exception 'Account profile unavailable.' using errcode = '22023';
  end if;
  if p_waived then
    insert into public.creator_activation_waivers(uid, granted_by) values (p_target_uid, auth.uid()::text)
      on conflict (uid) do update set granted_by = excluded.granted_by, granted_at = clock_timestamp(),
        revision = excluded.revision, ready_at = null
      returning revision into v_revision;
  else
    delete from public.creator_activation_waivers where uid = p_target_uid;
  end if;
  return jsonb_build_object('revision', v_revision);
end $$;

-- Pending waivers stop new checkouts immediately, but do not unlock activation.
create function public.has_creator_activation_waiver() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_strong_session();
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  return exists (select 1 from public.creator_activation_waivers where uid = auth.uid()::text);
end $$;

-- Called only after the server has expired payable Stripe activation sessions.
-- No INSERT: a stale cleanup completion cannot recreate a revoked waiver.
create function public.finalize_creator_activation_waiver(p_target_uid text, p_revision uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_service_role() then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  update public.creator_activation_waivers set ready_at = clock_timestamp()
    where uid = p_target_uid and revision = p_revision and ready_at is null;
  if found then return true; end if;
  return exists (select 1 from public.creator_activation_waivers
    where uid = p_target_uid and revision = p_revision and ready_at is not null);
end $$;
revoke all on function public.finalize_creator_activation_waiver(text,uuid) from public, anon, authenticated;
grant execute on function public.finalize_creator_activation_waiver(text,uuid) to service_role;

-- Preserve the flag, admin, paid and no-UID-oracle behavior of the shared gate.
create or replace function public.creator_activation_blocked(p_uid text default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select case when (select auth.uid()) is null then p_uid else (select auth.uid())::text end as uid
  )
  select coalesce((select (ps.value #>> '{}')::boolean from public.platform_settings ps
      where ps.key = 'require_activation_fee'), false)
    and (select uid from target) is not null
    and not public.is_admin()
    and not exists (select 1 from public.users u where u.uid = (select uid from target)
      and u.activation_fee_paid_at is not null)
    and not exists (select 1 from public.creator_activation_waivers w
      where w.uid = (select uid from target) and w.ready_at is not null);
$$;
comment on function public.creator_activation_blocked(text) is
  'Activation flag requires payment unless caller is admin, target paid, or target has a ready waiver. Pending waivers stop checkout but do not exempt activation. Signed-in callers always query themselves; no-session callers retain the existing p_uid behavior.';

revoke all on function public.admin_create_platform_invite(text,text,boolean),
  public.admin_list_platform_invites(), public.admin_revoke_platform_invite(uuid),
  public.get_my_platform_invite(uuid), public.accept_platform_invite(uuid),
  public.admin_set_activation_waiver(text,boolean), public.has_creator_activation_waiver(),
  public.creator_activation_blocked(text) from public, anon, authenticated;
grant execute on function public.admin_create_platform_invite(text,text,boolean),
  public.admin_list_platform_invites(), public.admin_revoke_platform_invite(uuid),
  public.get_my_platform_invite(uuid), public.accept_platform_invite(uuid),
  public.admin_set_activation_waiver(text,boolean), public.has_creator_activation_waiver(),
  public.creator_activation_blocked(text) to authenticated, service_role;

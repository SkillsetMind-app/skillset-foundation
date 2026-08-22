-- Pre-authorise an account that does not exist yet.
--
-- The founder is moving to a company-domain address and asked for it to be an
-- admin. Nobody can promote an account before it exists, and handing the roles
-- out by hand after signup is the manual step the ops console was built to
-- end. So the invitation is recorded now and consumed at signup.
--
-- Single use, deliberately. A standing list of "these addresses are admins" is
-- a back door that outlives the reason it was opened: anyone who later manages
-- to register that address inherits the grant. Consuming the row makes it an
-- invitation rather than a rule, and re-inviting is one INSERT.

create table if not exists public.admin_bootstrap_invites (
  email text primary key,
  roles jsonb not null default '["admin","teacher"]'::jsonb,
  note text,
  invited_at timestamptz not null default now()
);

-- Locked shut: no policies, so PostgREST reaches nothing. The only access is
-- through the SECURITY DEFINER signup trigger below, which is the same posture
-- the other server-owned tables use.
alter table public.admin_bootstrap_invites enable row level security;
revoke all on table public.admin_bootstrap_invites from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_invite jsonb;
begin
  -- An invitation waiting for this address decides the starting roles.
  delete from public.admin_bootstrap_invites
  where email = v_email
  returning roles into v_invite;

  if v_invite is not null then
    -- users_field_guard refuses an INSERT carrying admin unless the write is
    -- trusted. Opened only on this branch, and only for this transaction, so a
    -- normal signup still meets the full guard.
    perform set_config('skillset.trusted_write', 'on', true);
  end if;

  insert into public.users (uid, email, display_name, photo_url, roles, onboarding_completed)
  values (
    new.id::text,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'display_name', '')
    ),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    coalesce(v_invite, '["student"]'::jsonb),
    false
  )
  on conflict (uid) do nothing;

  if v_invite is not null then
    perform set_config('skillset.trusted_write', 'off', true);
    perform public.log_audit_event(
      'user.roles_changed',
      'system:signup-invite',
      null,
      'user',
      new.id::text,
      'Account created with pre-authorised roles ' || v_invite::text
        || '. The invitation was consumed and no longer exists.',
      jsonb_build_object('previous', '[]'::jsonb, 'next', v_invite, 'source', 'admin_bootstrap_invites')
    );
  end if;

  return new;
end;
$function$;

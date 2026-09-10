-- Conta pré-cadastrada por terceiro virava admin quando o convite chegava.
--
-- P1-1 da auditoria de permissões de 10/09. Alguém cria a conta com o e-mail
-- de quem vai ser convidado e uma senha dele; sem confirmação, ninguém entra
-- nela. O admin convida, o link do convite confirma o e-mail DAQUELA conta, a
-- pessoa aceita e ganha o papel, e quem pré-cadastrou entra com a própria
-- senha. admin_bootstrap_invites tinha a mesma porta e ainda dava os papéis no
-- cadastro, antes de qualquer confirmação.
--
-- Por que o aceite não só recusa e pede redefinição de senha: depois da
-- confirmação, quem conhece a senha entra, redefine ele mesmo e aceita no
-- lugar da pessoa; o banco não tem como saber quem redefiniu. Então, quando a
-- conta tem senha e o e-mail só foi confirmado depois de o convite existir, a
-- mesma transação que dá o papel apaga essa senha e corta todas as sessões
-- abertas até ali, inclusive a de quem aceitou (o corte de account_controls,
-- o mesmo da suspensão, sem suspender). O resultado traz
-- reauthentication_required; a pessoa entra de novo pelo link do e-mail, ou
-- por "esqueci a senha", e já cai no papel novo. Quem só tinha a senha perde o
-- acesso no instante em que o papel passa a valer.
--
-- admin_bootstrap_invites: cadastro sem confirmação nasce aluno; os papéis
-- entram quando o e-mail é confirmado (trigger novo em auth.users), e a senha
-- anterior à confirmação é apagada pelo mesmo motivo. Cadastro que já nasce
-- confirmado (Google, conta criada pelo admin) continua recebendo na hora.
--
-- Não exige segundo fator no aceite de convite admin: é decisão do Patrick.

create or replace function public.accept_platform_invite(p_invite_id uuid) returns jsonb
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
  v_password_predates_proof boolean;
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
  -- Senha anterior à prova do e-mail: pode ser de quem pré-cadastrou a conta.
  select coalesce(a.encrypted_password, '') <> '' and a.email_confirmed_at > v_invite.created_at
    into v_password_predates_proof
    from auth.users a where a.id = auth.uid();
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
  -- Na mesma transação do papel: some a senha de origem incerta e caem todas
  -- as sessões abertas até aqui. Só quem prova o e-mail entra de novo.
  if v_password_predates_proof then
    update auth.users set encrypted_password = '' where id = auth.uid();
    insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before)
      values (v_uid, false, null, clock_timestamp())
      on conflict (uid) do update set sessions_revoked_before = excluded.sessions_revoked_before;
  end if;
  v_invite.accepted_at := clock_timestamp();
  v_invite.accepted_by := v_uid;
  v_result := (to_jsonb(v_invite) - 'created_by' - 'accepted_by' - 'accepted_result' - 'accepted_waiver_revision')
    || jsonb_build_object('next_path', v_next_path, 'roles', v_roles,
      'waiver_revision', v_revision, 'activation_pending', v_revision is not null,
      'reauthentication_required', v_password_predates_proof);
  update public.platform_invites set accepted_at = v_invite.accepted_at, accepted_by = v_uid,
    accepted_waiver_revision = v_revision, accepted_result = v_result where id = p_invite_id;
  return v_result;
end $$;

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
  -- Só e-mail provado consome o convite. Sem confirmação a conta nasce aluna e
  -- admin_bootstrap_on_email_confirmed entrega os papéis na confirmação.
  if new.email_confirmed_at is not null then
    delete from public.admin_bootstrap_invites
    where email = v_email
    returning roles into v_invite;
  end if;

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

-- Confirmação do e-mail: entrega o convite que esperava e apaga a senha que
-- existia antes dela. BEFORE para trocar a senha na mesma escrita do Auth.
create function public.admin_bootstrap_on_email_confirmed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_previous jsonb;
  v_invite jsonb;
  v_roles jsonb;
  v_trusted text := current_setting('skillset.trusted_write', true);
begin
  select coalesce(roles, '[]'::jsonb) into v_previous
    from public.users where uid = new.id::text for update;
  if not found then return new; end if;
  delete from public.admin_bootstrap_invites
    where email = lower(btrim(coalesce(new.email, '')))
    returning roles into v_invite;
  if v_invite is null then return new; end if;
  new.encrypted_password := '';
  select jsonb_agg(distinct value order by value) into v_roles
    from jsonb_array_elements(v_previous || v_invite);
  perform set_config('skillset.trusted_write', 'on', true);
  update public.users set roles = v_roles, updated_at = clock_timestamp() where uid = new.id::text;
  perform set_config('skillset.trusted_write', coalesce(v_trusted, 'off'), true);
  perform public.log_audit_event(
    'user.roles_changed', 'system:signup-invite', null, 'user', new.id::text,
    'Email confirmed with pre-authorised roles ' || v_invite::text
      || '. The invitation was consumed and no longer exists.',
    jsonb_build_object('previous', v_previous, 'next', v_roles, 'source', 'admin_bootstrap_invites'));
  return new;
end;
$function$;
revoke all on function public.admin_bootstrap_on_email_confirmed() from public, anon, authenticated;
create trigger admin_bootstrap_on_email_confirmed
  before update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.admin_bootstrap_on_email_confirmed();

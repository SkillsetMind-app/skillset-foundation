-- Todo professor ganha perfil publico. Decisao do fundador em 06/10/2026: a
-- verificacao profissional e opcional e virou selo (#476); o perfil publico
-- (/@usuario, assinatura do curso, diretorio /instructors) nao depende mais
-- dela. So o selo separa verificado de nao verificado.
--
-- APLICADA DO PC EM PRODUCAO ANTES DO MERGE. As consultas de antes e depois
-- estao no corpo do PR.
--
-- O que muda:
--   1. Criterio de publicacao. Era: papel teacher E creator_verification_status
--      = 'approved'. Passa a ser: papel teacher E cadastro de professor
--      completo (teacher_terms_accepted_at preenchido -- a mesma condicao que
--      publish_teacher_course usa para "Teacher setup must be complete") E
--      conta nao suspensa em account_controls (suspender e bloquear gravam
--      suspended = true). Aprovacao nao entra.
--   2. Suspensao e exclusao nova: antes um professor aprovado e suspenso
--      continuava na vitrine. Como admin_set_account_control so escreve em
--      account_controls, um trigger la reprojeta: suspender tira do ar,
--      restaurar devolve.
--   3. A projecao sai de dentro de sync_public_profile() (corpo vigente:
--      20261006010000) para project_public_profile(uid), porque agora tem
--      TRES chamadores: o trigger de users, o de account_controls e o
--      backfill. Mesmo motivo de public_storefront_projection e
--      public_professional_badge. Colunas, vitrine e selo sao copiados sem
--      mudanca; so o criterio mudou.
--   4. O trigger de users passa a disparar tambem em teacher_terms_accepted_at:
--      sem isso, aceitar os termos depois nao publicaria o perfil.
--   5. Backfill: entram os elegiveis sem linha; saem os suspensos e quem nunca
--      terminou o cadastro. Quem ja esta certo nao e tocado (updated_at e a
--      ordem do diretorio).
--
-- Selo: identico. verified_professional so com status 'approved' E caso
-- aprovado; agora e ele, e nao a existencia da linha, que diz "verificado".
-- Nada ordena, filtra ou destaca por ele.
--
-- Grants e RLS nao mudam: anon le public_profiles inteira e nada privado vira
-- coluna. As funcoes novas ficam fora da superficie REST.
--
-- Prova: supabase/tests/20261006020000_perfil_publico_todo_professor_smoke.sql.

-- Nao fica esperando atras de uma escrita longa em users/public_profiles:
-- melhor falhar e reaplicar do que enfileirar o site inteiro atras do trigger.
-- (Vale dentro de transacao: arquivo enviado como consulta unica ou psql
-- --single-transaction. No psql -f puro e so um aviso.)
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Criterio
-- ---------------------------------------------------------------------------

-- Sem security definer de proposito: le account_controls, que so o dono le.
-- Quem chama e a projecao (security definer) ou a propria migration.
create or replace function public.public_profile_eligible(p_uid text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  -- jsonb_exists em vez do operador `?`: alguns drivers tratam `?` como
  -- placeholder de parametro e quebram o corpo da funcao.
  select exists (
    select 1
    from public.users u
    where u.uid = p_uid
      and coalesce(jsonb_exists(u.roles::jsonb, 'teacher'), false)
      and u.teacher_terms_accepted_at is not null
      and not exists (
        select 1 from public.account_controls c
        where c.uid = u.uid and c.suspended
      )
  );
$$;

comment on function public.public_profile_eligible(text) is
  'Criterio do perfil publico: papel teacher, termos de professor aceitos (o "setup complete" de publish_teacher_course) e conta nao suspensa. Nao exige verificacao.';

-- ---------------------------------------------------------------------------
-- 2. Projecao (corpo de sync_public_profile em 20261006010000, criterio novo)
-- ---------------------------------------------------------------------------

create or replace function public.project_public_profile(p_uid text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u public.users;
  badge_kind text;
  badge_at timestamptz;
begin
  if not public.public_profile_eligible(p_uid) then
    -- Perdeu o papel, nao terminou o cadastro, foi suspenso ou nao existe
    -- mais => sai da vitrine.
    delete from public.public_profiles where uid = p_uid;
    return;
  end if;

  select * into u from public.users where uid = p_uid;

  -- Selo: status aprovado E caso aprovado. Publicar nao exige mais
  -- aprovacao, entao e esta condicao que separa verificado de nao verificado.
  if u.creator_verification_status = 'approved' then
    select b.verification_kind, b.verified_at
      into badge_kind, badge_at
    from public.public_professional_badge(u.uid) b;
  end if;

  insert into public.public_profiles
    (uid, display_name, username, photo_url, bio, credentials, storefront,
     verified_professional, verification_kind, verified_at, updated_at)
  values
    (u.uid, u.display_name, u.username, u.photo_url, u.bio,
     u.credentials,
     public.public_storefront_projection(u.storefront, u.current_plan_id),
     badge_kind is not null, badge_kind, badge_at,
     now())
  on conflict (uid) do update set
    display_name          = excluded.display_name,
    username              = excluded.username,
    photo_url             = excluded.photo_url,
    bio                   = excluded.bio,
    credentials           = excluded.credentials,
    storefront            = excluded.storefront,
    verified_professional = excluded.verified_professional,
    verification_kind     = excluded.verification_kind,
    verified_at           = excluded.verified_at,
    updated_at            = now();
end;
$$;

comment on function public.project_public_profile(text) is
  'Projeta public.users -> public.public_profiles para p_uid: grava se public_profile_eligible, senao apaga. Chamada pelos triggers de users e account_controls.';

create or replace function public.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.project_public_profile(new.uid);
  return new;
end;
$$;

comment on function public.sync_public_profile() is
  'Trigger de users: reprojeta public_profiles via project_public_profile. Substitui a Cloud Function do Firebase perdida na migracao.';

-- Mesma lista de 20260808140000 + teacher_terms_accepted_at. CREATE OR REPLACE
-- (PG 14+) em vez de DROP + CREATE: nao deixa um instante sem trigger.
create or replace trigger users_sync_public_profile_aiu
after insert or update of
  display_name, username, photo_url, bio, credentials,
  roles, creator_verification_status, storefront, current_plan_id,
  teacher_terms_accepted_at
on public.users
for each row execute function public.sync_public_profile();

-- ---------------------------------------------------------------------------
-- 3. Suspender e restaurar reprojetam
-- ---------------------------------------------------------------------------

create or replace function public.sync_public_profile_on_account_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.project_public_profile(old.uid);
  else
    perform public.project_public_profile(new.uid);
  end if;
  return null;
end;
$$;

create or replace trigger account_controls_sync_public_profile_aiud
after insert or delete or update of suspended
on public.account_controls
for each row execute function public.sync_public_profile_on_account_control();

-- PUBLIC ganha EXECUTE por padrao; nenhuma destas fica na superficie REST
-- (mesmo padrao de 20260806220000 e 20261006010000).
revoke execute on function public.public_profile_eligible(text) from public, anon, authenticated;
revoke execute on function public.project_public_profile(text) from public, anon, authenticated;
revoke execute on function public.sync_public_profile_on_account_control() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill (idempotente)
-- ---------------------------------------------------------------------------

-- Entram: professores com cadastro completo, sem verificacao aprovada, que
-- ainda nao tem linha.
do $$
begin
  perform public.project_public_profile(u.uid)
  from public.users u
  where public.public_profile_eligible(u.uid)
    and not exists (select 1 from public.public_profiles pp where pp.uid = u.uid);
end $$;

-- Saem: suspensos, aprovados que nunca aceitaram os termos e linhas orfas.
delete from public.public_profiles pp
where not public.public_profile_eligible(pp.uid);

-- ---------------------------------------------------------------------------
-- 5. Verificacao (falha a migracao se a projecao nao bater)
-- ---------------------------------------------------------------------------

do $$
declare
  divergentes integer;
  fora_do_criterio integer;
  selo_divergente integer;
  executavel integer;
  total integer;
  com_selo integer;
begin
  select count(*) into divergentes
  from public.users u
  where public.public_profile_eligible(u.uid)
    <> exists (select 1 from public.public_profiles pp where pp.uid = u.uid);
  assert divergentes = 0,
    format('projecao divergente do criterio em %s usuario(s)', divergentes);

  -- O criterio dito de novo, sem a funcao: nenhuma linha de quem nao e
  -- professor, nao aceitou os termos ou esta suspenso.
  select count(*) into fora_do_criterio
  from public.public_profiles pp
  left join public.users u on u.uid = pp.uid
  where u.uid is null
     or not coalesce(jsonb_exists(u.roles::jsonb, 'teacher'), false)
     or u.teacher_terms_accepted_at is null
     or exists (select 1 from public.account_controls c where c.uid = pp.uid and c.suspended);
  assert fora_do_criterio = 0,
    format('%s perfil(is) publico(s) fora do criterio', fora_do_criterio);

  -- O selo continua exigindo status aprovado E caso aprovado.
  select count(*) into selo_divergente
  from public.public_profiles pp
  join public.users u on u.uid = pp.uid
  cross join lateral public.public_professional_badge(u.uid) b
  where pp.verified_professional
    is distinct from (u.creator_verification_status = 'approved' and b.verification_kind is not null);
  assert selo_divergente = 0,
    format('selo divergente de status + caso aprovado em %s perfil(is)', selo_divergente);

  -- Quem roda o trigger (dono de sync_public_profile) executa os auxiliares.
  assert has_function_privilege(
      (select proowner from pg_proc where oid = 'public.sync_public_profile()'::regprocedure),
      'public.project_public_profile(text)', 'execute')
    and has_function_privilege(
      (select proowner from pg_proc where oid = 'public.sync_public_profile()'::regprocedure),
      'public.public_profile_eligible(text)', 'execute'),
    'o dono de sync_public_profile nao executa os auxiliares da projecao';

  select count(*) into executavel
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('public_profile_eligible', 'project_public_profile',
                      'sync_public_profile_on_account_control', 'sync_public_profile')
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));
  assert executavel = 0, format('funcao da projecao executavel por anon/authenticated: %s', executavel);

  select count(*), count(*) filter (where verified_professional)
    into total, com_selo
  from public.public_profiles;
  raise notice 'perfis publicos: % (com selo: %, sem selo: %)', total, com_selo, total - com_selo;
end $$;

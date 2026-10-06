-- Selo "profissional verificado" no perfil publico. So cosmetico: nada de
-- ranking, busca, diretorio ou destaque le estas colunas.
--
-- APLICADA DO PC EM PRODUCAO ANTES DO MERGE. O codigo do PR le as colunas
-- novas de public_profiles (select explicito no perfil montado no servidor);
-- sem elas a pagina /@usuario quebraria no deploy.
--
-- O que muda:
--   1. public_profiles ganha verified_professional, verification_kind e
--      verified_at. So a ESPECIE e a DATA vao para o publico: numero de
--      registro, regiao, links e documento continuam em
--      creator_verification_cases, que anon nao le.
--   2. sync_public_profile() (corpo vigente: 20260808140000) preenche as tres
--      apenas com users.creator_verification_status = 'approved'. O resto do
--      corpo e identico.
--   3. Trigger novo em creator_verification_cases. Hoje so o trigger de users
--      (users_sync_public_profile_aiu) dispara a projecao; corrigir a especie
--      ou a data de um caso ja aprovado, sem tocar em users, deixava o perfil
--      com o valor velho.
--   4. Backfill das linhas existentes.
--
-- Hoje toda linha de public_profiles ja e de professor aprovado (e o criterio
-- de publicacao), entao todo perfil publico sai com o selo. O selo nao depende
-- desse criterio: se a publicacao um dia deixar de exigir aprovacao, a coluna
-- continua falsa para quem nao foi aprovado.
--
-- Grants e RLS nao mudam: anon ja le public_profiles inteira (policy
-- public_profiles_select_public) e continua sem escrita.
--
-- Prova: supabase/tests/20261006010000_selo_profissional_verificado_smoke.sql.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column if not exists verified_professional boolean not null default false,
  add column if not exists verification_kind text,
  add column if not exists verified_at timestamptz;

-- O invariante no proprio banco: especie conhecida so com o selo; sem selo,
-- nada. A data pode faltar (aprovacao antiga sem caso registrado).
alter table public.public_profiles
  drop constraint if exists public_profiles_professional_badge_check;
alter table public.public_profiles
  add constraint public_profiles_professional_badge_check check (
    case
      when verified_professional
        then coalesce(verification_kind in ('psychologist', 'coach', 'holistic', 'other'), false)
      else verification_kind is null and verified_at is null
    end
  );

comment on column public.public_profiles.verified_professional is
  'Selo cosmetico: users.creator_verification_status = approved. Escrito so por sync_public_profile() e sync_public_professional_badge(). Nao entra em ranking nem destaque.';
comment on column public.public_profiles.verification_kind is
  'Especie do ultimo caso aprovado (psychologist, coach, holistic, other; legacy vira other). Null sem o selo. Nunca o numero de registro.';
comment on column public.public_profiles.verified_at is
  'Quando o ultimo caso aprovado foi revisado. Null sem o selo ou sem caso registrado.';

-- ---------------------------------------------------------------------------
-- 2. Especie e data do ultimo caso aprovado
-- ---------------------------------------------------------------------------

-- Funcao separada porque tem TRES chamadores (a projecao, o trigger do caso e o
-- backfill), mesmo motivo de public_storefront_projection. 'legacy' (a admissao
-- antiga, sem especie) e qualquer valor desconhecido viram 'other': a frase
-- generica, que promete menos. Sem caso aprovado: 'other' e data nula.
create or replace function public.public_professional_badge(p_uid text)
returns table (verification_kind text, verified_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    case
      when c.verification_kind in ('psychologist', 'coach', 'holistic') then c.verification_kind
      else 'other'
    end,
    coalesce(c.reviewed_at, c.updated_at)
  from (select 1) as sempre
  left join lateral (
    select cvc.verification_kind, cvc.reviewed_at, cvc.updated_at
    from public.creator_verification_cases cvc
    where cvc.creator_id = p_uid
      and cvc.status = 'approved'
    order by cvc.reviewed_at desc nulls last, cvc.updated_at desc
    limit 1
  ) as c on true;
$$;

comment on function public.public_professional_badge(text) is
  'Especie publica e data do ultimo caso aprovado de p_uid. Uso interno da projecao de public_profiles.';

-- ---------------------------------------------------------------------------
-- 3. Projecao (mesmo corpo de 20260808140000, + as tres colunas do selo)
-- ---------------------------------------------------------------------------

create or replace function public.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_publish boolean;
  is_verified boolean;
  badge_kind text;
  badge_at timestamptz;
begin
  -- jsonb_exists em vez do operador `?`: alguns drivers tratam `?` como
  -- placeholder de parametro e quebram o corpo da funcao.
  should_publish :=
    coalesce(jsonb_exists(new.roles::jsonb, 'teacher'), false)
    and new.creator_verification_status = 'approved';

  -- Selo: so com a aprovacao. Hoje coincide com should_publish, mas o selo nao
  -- pode herdar uma mudanca futura no criterio de publicacao.
  is_verified := coalesce(new.creator_verification_status = 'approved', false);

  if should_publish then
    if is_verified then
      select b.verification_kind, b.verified_at
        into badge_kind, badge_at
      from public.public_professional_badge(new.uid) b;
    end if;

    insert into public.public_profiles
      (uid, display_name, username, photo_url, bio, credentials, storefront,
       verified_professional, verification_kind, verified_at, updated_at)
    values
      (new.uid, new.display_name, new.username, new.photo_url, new.bio,
       new.credentials,
       public.public_storefront_projection(new.storefront, new.current_plan_id),
       is_verified, badge_kind, badge_at,
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
  else
    -- Perdeu o papel ou a aprovacao => sai da vitrine. Sem isso, revogar um
    -- professor o deixaria listado publicamente para sempre.
    delete from public.public_profiles where uid = new.uid;
  end if;

  return new;
end;
$$;

-- O trigger de users (users_sync_public_profile_aiu, 20260808140000) ja dispara
-- em creator_verification_status e nao muda.

-- ---------------------------------------------------------------------------
-- 4. Corrigir o caso tambem reprojeta o selo
-- ---------------------------------------------------------------------------

-- review_creator_verification grava o caso ANTES de users, entao a aprovacao
-- normal ja chega certa pelo trigger de users. Este cobre o resto: especie ou
-- data corrigidas direto no caso, caso apagado, segundo caso aprovado.
--
-- So atualiza quem ja esta no perfil publico; criar ou apagar a linha continua
-- sendo decisao de sync_public_profile(). updated_at fica como esta: o
-- diretorio de professores ordena por ele, e o selo nao move ninguem la.
create or replace function public.sync_public_professional_badge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text;
begin
  if tg_op = 'DELETE' then
    v_uid := old.creator_id;
  else
    v_uid := new.creator_id;
  end if;

  update public.public_profiles pp
  set verified_professional = u.creator_verification_status = 'approved',
      verification_kind = case when u.creator_verification_status = 'approved' then b.verification_kind end,
      verified_at = case when u.creator_verification_status = 'approved' then b.verified_at end
  from public.users u
  cross join lateral public.public_professional_badge(u.uid) b
  where u.uid = v_uid
    and pp.uid = u.uid;

  return null;
end;
$$;

drop trigger if exists creator_verification_cases_sync_badge_aiud on public.creator_verification_cases;
create trigger creator_verification_cases_sync_badge_aiud
after insert or delete or update of status, verification_kind, reviewed_at, updated_at
on public.creator_verification_cases
for each row execute function public.sync_public_professional_badge();

-- Funcoes de trigger e o auxiliar nunca ficam na superficie REST (mesmo padrao
-- de 20260806220000): PUBLIC ganha EXECUTE por padrao.
revoke execute on function public.public_professional_badge(text) from public, anon, authenticated;
revoke execute on function public.sync_public_professional_badge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill de quem ja esta publicado
-- ---------------------------------------------------------------------------

-- Sem tocar em updated_at, pelo mesmo motivo do trigger acima.
update public.public_profiles pp
set verified_professional = u.creator_verification_status = 'approved',
    verification_kind = case when u.creator_verification_status = 'approved' then b.verification_kind end,
    verified_at = case when u.creator_verification_status = 'approved' then b.verified_at end
from public.users u
cross join lateral public.public_professional_badge(u.uid) b
where pp.uid = u.uid;

-- ---------------------------------------------------------------------------
-- 6. Verificacao (falha a migracao se a projecao nao bater)
-- ---------------------------------------------------------------------------

do $$
declare
  divergentes integer;
  com_selo integer;
  executavel integer;
begin
  select count(*) into divergentes
  from public.public_profiles pp
  join public.users u on u.uid = pp.uid
  where pp.verified_professional is distinct from (u.creator_verification_status = 'approved');
  assert divergentes = 0,
    format('selo divergente do status de verificacao em %s perfil(is)', divergentes);

  select count(*) into executavel
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('public_professional_badge', 'sync_public_professional_badge')
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));
  assert executavel = 0, format('funcao do selo executavel por anon/authenticated: %s', executavel);

  select count(*) into com_selo from public.public_profiles where verified_professional;
  raise notice 'selo projetado: % perfil(is) com selo', com_selo;
end $$;

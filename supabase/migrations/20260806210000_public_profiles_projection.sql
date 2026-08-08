-- public_profiles: restaura a projecao perdida na migracao Firebase -> Supabase.
--
-- A tabela `public_profiles` existe, e anonimamente legivel e esta na publicacao
-- do Realtime, mas NADA escrevia nela desde a migracao: a projecao vivia numa
-- Cloud Function do Firebase que nao foi portada. Prova em producao em
-- 2026-08-06: public_profiles = 0 linhas, users = 6, professores = 4.
-- Consequencia: diretorio de instrutores, pagina /instructors/[uid] e o card
-- "Your instructor" na pagina do curso renderizavam vazio para 100% dos
-- professores.
--
-- Aqui a projecao vira um trigger no proprio Postgres, entao nao ha mais um
-- servico externo que possa sumir sem ninguem perceber.
--
-- Criterio de publicacao: papel `teacher` E `creator_verification_status =
-- 'approved'`. Isso e o que a UI ja promete por escrito ("Public instructor
-- profiles appear after review" / "SkillsetMind only lists real published
-- profiles") — publicar professor nao revisado contradiria a propria copy.

-- ---------------------------------------------------------------------------
-- 1. Funcao de projecao
-- ---------------------------------------------------------------------------

create or replace function public.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_publish boolean;
begin
  -- jsonb_exists em vez do operador `?`: alguns drivers tratam `?` como
  -- placeholder de parametro e quebram o corpo da funcao.
  should_publish :=
    coalesce(jsonb_exists(new.roles::jsonb, 'teacher'), false)
    and new.creator_verification_status = 'approved';

  if should_publish then
    insert into public.public_profiles
      (uid, display_name, username, photo_url, bio, credentials, updated_at)
    values
      (new.uid, new.display_name, new.username, new.photo_url, new.bio,
       new.credentials, now())
    on conflict (uid) do update set
      display_name = excluded.display_name,
      username     = excluded.username,
      photo_url    = excluded.photo_url,
      bio          = excluded.bio,
      credentials  = excluded.credentials,
      updated_at   = now();
  else
    -- Perdeu o papel ou a aprovacao => sai da vitrine. Sem isso, revogar um
    -- professor o deixaria listado publicamente para sempre.
    delete from public.public_profiles where uid = new.uid;
  end if;

  return new;
end;
$$;

comment on function public.sync_public_profile() is
  'Projeta public.users -> public.public_profiles para professores aprovados. Substitui a Cloud Function do Firebase perdida na migracao.';

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists users_sync_public_profile_aiu on public.users;
create trigger users_sync_public_profile_aiu
after insert or update of
  display_name, username, photo_url, bio, credentials,
  roles, creator_verification_status
on public.users
for each row execute function public.sync_public_profile();

create or replace function public.drop_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.public_profiles where uid = old.uid;
  return old;
end;
$$;

-- ponytail: trigger de DELETE em vez de FK com ON DELETE CASCADE — nao assume
-- que users.uid seja a PK nem que os tipos casem. Troque por FK se algum dia
-- quiser a garantia no nivel do schema.
drop trigger if exists users_drop_public_profile_ad on public.users;
create trigger users_drop_public_profile_ad
after delete on public.users
for each row execute function public.drop_public_profile();

-- ---------------------------------------------------------------------------
-- 3. Backfill dos usuarios que ja existem
-- ---------------------------------------------------------------------------

insert into public.public_profiles
  (uid, display_name, username, photo_url, bio, credentials, updated_at)
select u.uid, u.display_name, u.username, u.photo_url, u.bio, u.credentials, now()
from public.users u
where jsonb_exists(u.roles::jsonb, 'teacher')
  and u.creator_verification_status = 'approved'
on conflict (uid) do update set
  display_name = excluded.display_name,
  username     = excluded.username,
  photo_url    = excluded.photo_url,
  bio          = excluded.bio,
  credentials  = excluded.credentials,
  updated_at   = now();

-- Limpa qualquer linha que nao satisfaca mais o criterio (defensivo: a tabela
-- estava vazia, mas isto torna a migracao idempotente se rodar de novo).
delete from public.public_profiles pp
where not exists (
  select 1 from public.users u
  where u.uid = pp.uid
    and jsonb_exists(u.roles::jsonb, 'teacher')
    and u.creator_verification_status = 'approved'
);

-- ---------------------------------------------------------------------------
-- 4. Endurecer as permissoes
-- ---------------------------------------------------------------------------

-- O schema concedia ALL a anon/authenticated. So o RLS (sem policy de escrita)
-- impedia gravacao — uma unica policy mal escrita no futuro abriria a tabela
-- para qualquer visitante. A projecao roda como SECURITY DEFINER, entao nenhum
-- cliente precisa de escrita aqui.
revoke insert, update, delete on public.public_profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verificacao (falha a migracao se a projecao nao bater)
-- ---------------------------------------------------------------------------

do $$
declare
  esperado integer;
  obtido   integer;
begin
  select count(*) into esperado
  from public.users
  where jsonb_exists(roles::jsonb, 'teacher')
    and creator_verification_status = 'approved';

  select count(*) into obtido from public.public_profiles;

  assert esperado = obtido,
    format('projecao divergente: esperado %s professores aprovados, public_profiles tem %s',
           esperado, obtido);

  raise notice 'public_profiles projetada: % linha(s)', obtido;
end $$;

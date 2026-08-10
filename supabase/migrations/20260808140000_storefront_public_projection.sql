-- Sub-plano 3: fazer a vitrine do professor chegar na pagina publica.
--
-- Estado antes desta migracao: o editor de vitrine
-- (src/components/teacher/storefront-settings-panel.tsx) salva tema, cor de
-- destaque, logo, imagem de capa, tagline, ordem dos cursos e curso em
-- destaque em `users.storefront`. NADA disso era lido fora do proprio editor.
-- A pagina publica /instructors/[uid] le `public_profiles`, que nem tinha a
-- coluna. O professor configurava a vitrine e nada mudava para o visitante.
--
-- Aqui a coluna e criada e a projecao (trigger `sync_public_profile`, criada em
-- 20260806210000_public_profiles_projection.sql) passa a alimenta-la.
--
-- DUAS travas, ambas no banco porque `public_profiles` e legivel por `anon`:
--
-- 1. PLANO. `storefrontTemplates` e recurso pago -- espelha
--    planEntitlements[*].features.storefrontTemplates em
--    src/domain/entitlements.ts (off no free, on do starter pra cima). Free
--    projeta NULL e a pagina cai no tema padrao. Ha teste em
--    src/domain/entitlements.test.tsx que falha se os dois divergirem.
--
-- 2. SANITIZACAO. O editor ja valida na escrita, mas a projecao le o jsonb
--    cru: uma linha editada fora do app poderia injetar `javascript:` numa
--    tag <img> ou CSS arbitrario via accentColor (que vira valor de custom
--    property). URL precisa ser https, cor precisa ser hex de 6 digitos,
--    tema precisa estar na lista. O que nao passa vira NULL, nao erro -- a
--    vitrine degrada pro padrao em vez de quebrar.

-- ---------------------------------------------------------------------------
-- 1. Coluna
-- ---------------------------------------------------------------------------

alter table public.public_profiles
  add column if not exists storefront jsonb;

comment on column public.public_profiles.storefront is
  'Recorte publico e sanitizado de users.storefront. Escrito so por sync_public_profile(). Null quando o plano nao inclui storefrontTemplates.';

-- ---------------------------------------------------------------------------
-- 2. Recorte publico
-- ---------------------------------------------------------------------------

-- Funcao separada porque tem DOIS chamadores (o trigger e o backfill logo
-- abaixo). Duplicar as regras de sanitizacao nos dois seria convite a divergir.
create or replace function public.public_storefront_projection(
  p_storefront jsonb,
  p_plan_id text
)
returns jsonb
language sql
immutable
as $$
  select case
    when p_storefront is null then null
    when coalesce(p_plan_id, 'free') = 'free' then null
    else nullif(
      jsonb_strip_nulls(
        jsonb_build_object(
          'branding',
          nullif(
            jsonb_strip_nulls(
              jsonb_build_object(
                'themePreset',
                case
                  when p_storefront -> 'branding' ->> 'themePreset'
                    in ('default', 'warm', 'cool', 'mono')
                  then p_storefront -> 'branding' ->> 'themePreset'
                end,
                'accentColor',
                case
                  when p_storefront -> 'branding' ->> 'accentColor'
                    ~ '^#[0-9a-fA-F]{6}$'
                  then p_storefront -> 'branding' ->> 'accentColor'
                end,
                'logoUrl',
                case
                  when p_storefront -> 'branding' ->> 'logoUrl' ~* '^https://'
                  then p_storefront -> 'branding' ->> 'logoUrl'
                end,
                'heroImageUrl',
                case
                  when p_storefront -> 'branding' ->> 'heroImageUrl' ~* '^https://'
                  then p_storefront -> 'branding' ->> 'heroImageUrl'
                end
              )
            ),
            '{}'::jsonb
          ),
          'showcase',
          nullif(
            jsonb_strip_nulls(
              jsonb_build_object(
                -- Mesmo teto do editor (maxStorefrontTaglineLength = 200).
                'tagline',
                nullif(
                  btrim(left(coalesce(p_storefront -> 'showcase' ->> 'tagline', ''), 200)),
                  ''
                ),
                'featuredCourseId',
                nullif(btrim(coalesce(p_storefront -> 'showcase' ->> 'featuredCourseId', '')), ''),
                -- Só a ordem; os ids são cruzados com os cursos publicados que
                -- a página já buscou, então um id inventado aqui não mostra nada.
                'orderedCourseIds',
                case
                  when jsonb_typeof(p_storefront -> 'showcase' -> 'orderedCourseIds') = 'array'
                  then p_storefront -> 'showcase' -> 'orderedCourseIds'
                end
              )
            ),
            '{}'::jsonb
          )
        )
      ),
      '{}'::jsonb
    )
  end;
$$;

comment on function public.public_storefront_projection(jsonb, text) is
  'Recorte publico de users.storefront: aplica a trava de plano (storefrontTemplates) e sanitiza URLs/cor/tema. Espelha src/domain/entitlements.ts.';

-- ---------------------------------------------------------------------------
-- 3. Projecao (mesmo corpo de 20260806210000, + storefront)
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
      (uid, display_name, username, photo_url, bio, credentials, storefront, updated_at)
    values
      (new.uid, new.display_name, new.username, new.photo_url, new.bio,
       new.credentials,
       public.public_storefront_projection(new.storefront, new.current_plan_id),
       now())
    on conflict (uid) do update set
      display_name = excluded.display_name,
      username     = excluded.username,
      photo_url    = excluded.photo_url,
      bio          = excluded.bio,
      credentials  = excluded.credentials,
      storefront   = excluded.storefront,
      updated_at   = now();
  else
    -- Perdeu o papel ou a aprovacao => sai da vitrine. Sem isso, revogar um
    -- professor o deixaria listado publicamente para sempre.
    delete from public.public_profiles where uid = new.uid;
  end if;

  return new;
end;
$$;

-- A lista de colunas do `after update of` e o gatilho real: sem `storefront` e
-- `current_plan_id` aqui, salvar a vitrine (ou trocar de plano) nao dispararia
-- nada e a projecao ficaria eternamente com o valor antigo.
drop trigger if exists users_sync_public_profile_aiu on public.users;
create trigger users_sync_public_profile_aiu
after insert or update of
  display_name, username, photo_url, bio, credentials,
  roles, creator_verification_status, storefront, current_plan_id
on public.users
for each row execute function public.sync_public_profile();

-- ---------------------------------------------------------------------------
-- 4. Backfill de quem ja esta publicado
-- ---------------------------------------------------------------------------

update public.public_profiles pp
set storefront = public.public_storefront_projection(u.storefront, u.current_plan_id),
    updated_at = now()
from public.users u
where u.uid = pp.uid;

-- ---------------------------------------------------------------------------
-- 5. Verificacao
-- ---------------------------------------------------------------------------

do $$
declare
  divergentes integer;
begin
  -- Nenhuma linha publica pode carregar vitrine de professor no plano free.
  select count(*) into divergentes
  from public.public_profiles pp
  join public.users u on u.uid = pp.uid
  where pp.storefront is not null
    and coalesce(u.current_plan_id, 'free') = 'free';

  assert divergentes = 0,
    format('trava de plano furada: %s perfil(is) free com vitrine publicada', divergentes);

  raise notice 'projecao de vitrine aplicada';
end $$;

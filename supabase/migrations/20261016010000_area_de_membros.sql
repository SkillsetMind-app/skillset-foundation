-- Area de membros por criador (fase 1, dados).
--
-- Uma area por criador junta os produtos dele. O aluno ve tres secoes:
-- continuar de onde parou, meus produtos e mais deste criador (so vitrine,
-- com cadeado e link para a pagina de vendas).
--
-- A area e VIRTUAL ate o criador salvar pela primeira vez. Sem linha valem os
-- padroes: nome = display_name do criador, tema claro, sem capa e todos os
-- produtos publicados, do mais novo para o mais antigo. Sem backfill e sem
-- gatilho.
--
-- A area NAO libera aula nenhuma. O acesso continua por curso
-- (course_lesson_content_select, course_assets_select, course_content_select
-- e a rota video-token). Do que o aluno nao comprou sai so id, titulo, capa,
-- preco e a chave da pagina de vendas.
--
-- Escrita so por save_my_member_area e save_my_member_area_products; as
-- tabelas nao tem policy de escrita. Os campos members_* de courses seguem
-- sendo a cara de cada produto dentro da propria sala de aula.

create table public.member_areas (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null unique references public.users(uid) on delete cascade,
  name text check (name is null or char_length(name) between 1 and 80),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  -- Arquivo do proprio criador no bucket public-media. Sem ".." e sem
  -- caractere fora da lista: o navegador resolveria "../" para a pasta de outro.
  cover_path text check (cover_path is null or (
    char_length(cover_path) <= 300
    and starts_with(cover_path, 'users/' || owner_id || '/member-area/')
    and cover_path !~ '\.\.|[^A-Za-z0-9._/-]')),
  welcome_text text check (welcome_text is null or char_length(welcome_text) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.member_area_products (
  area_id uuid not null references public.member_areas(id) on delete cascade,
  course_id text not null unique references public.courses(id) on delete cascade,
  position int not null check (position between 0 and 9999),
  visible boolean not null default true,
  primary key (area_id, course_id)
);

alter table public.member_areas enable row level security;
alter table public.member_area_products enable row level security;
revoke all on public.member_areas from public, anon, authenticated, service_role;
revoke all on public.member_area_products from public, anon, authenticated, service_role;
grant select on public.member_areas to authenticated;
grant select on public.member_area_products to authenticated;

create policy member_areas_select_owner on public.member_areas
  for select to authenticated
  using (owner_id = (select auth.uid())::text or (select public.is_admin()));
create policy member_area_products_select_owner on public.member_area_products
  for select to authenticated
  using (exists (
    select 1 from public.member_areas a
    where a.id = member_area_products.area_id
      and (a.owner_id = (select auth.uid())::text or (select public.is_admin()))));

create policy account_access_guard on public.member_areas as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));
create policy account_access_guard on public.member_area_products as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

-- "@usuario" (qualquer caixa) ou uid -> uid, pelo perfil publico. Sem perfil
-- (conta suspensa, sem termos de professor) nao ha area.
create function public.resolve_member_area_owner(p_ref text)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p.uid
  from public.public_profiles p
  where case when left(btrim(p_ref), 1) = '@'
    then p.username = lower(substr(btrim(p_ref), 2))
    else p.uid = btrim(p_ref) end
  limit 1;
$function$;
revoke all on function public.resolve_member_area_owner(text) from public, anon, authenticated, service_role;

-- Todos os produtos do criador com a ordem e a visibilidade da area. Produto
-- fora da lista salva (ou area virtual) vai para o fim, visivel, do mais novo
-- para o mais antigo. Funcao em vez de tabela temporaria: chamada de dentro de
-- uma funcao STABLE.
create function public.member_area_product_order(p_owner text)
returns table (course_id text, sort_key int, visible boolean, created_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, coalesce(mp.position, 10000), coalesce(mp.visible, true), c.created_at
  from public.courses c
  left join public.member_areas a on a.owner_id = c.owner_id
  left join public.member_area_products mp on mp.area_id = a.id and mp.course_id = c.id
  where c.owner_id = p_owner;
$function$;
revoke all on function public.member_area_product_order(text) from public, anon, authenticated, service_role;

-- A tela do aluno. null quando: sem sessao forte, o criador nao existe, ou quem
-- chama nao e o dono nem tem matricula ativa/concluida em produto do dono.
create function public.get_member_area_home(p_area_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_owner text;
  v_home jsonb;
begin
  if v_me is null or not public.session_is_strong() then
    return null;
  end if;
  v_owner := public.resolve_member_area_owner(p_area_ref);
  if v_owner is null then
    return null;
  end if;
  if v_owner <> v_me and not exists (
    select 1 from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.user_id = v_me and e.status in ('active', 'completed') and c.owner_id = v_owner
  ) then
    return null;
  end if;

  with ordered as (
    select o.course_id, o.sort_key, o.visible, o.created_at
    from public.member_area_product_order(v_owner) o
  ),
  -- Tudo o que esta pessoa comprou do criador, inclusive produto oculto.
  mine as (
    select e.id as enrollment_id, e.course_id, e.last_lesson_id, e.updated_at,
      e.progress_percent, e.status
    from public.enrollments e
    join ordered o on o.course_id = e.course_id
    where e.user_id = v_me and e.status in ('active', 'completed')
  ),
  -- Ultima aula tocada; sem nenhuma, a ultima aula aberta da matricula.
  resume as (
    select x.course_id, x.lesson_id, x.position_seconds, x.seen_at, x.pri, c.title as course_title,
      jsonb_path_query_first(c.modules, '$[*].lessons[*] ? (@.id == $id).title',
        jsonb_build_object('id', x.lesson_id)) #>> '{}' as lesson_title
    from (
      select m.course_id, p.lesson_id, p.position_seconds, p.last_seen_at as seen_at, 0 as pri
      from mine m
      join public.lesson_playback p on p.enrollment_id = m.enrollment_id and p.user_id = v_me
      union all
      select m.course_id, m.last_lesson_id, 0, m.updated_at, 1
      from mine m
      where m.last_lesson_id is not null
    ) x
    join public.courses c on c.id = x.course_id
  )
  select jsonb_build_object(
    'area', (
      select jsonb_build_object(
        'owner_id', v_owner,
        'username', p.username,
        'creator_name', p.display_name,
        'creator_photo_url', p.photo_url,
        'name', coalesce(a.name, p.display_name),
        'theme', coalesce(a.theme, 'light'),
        'cover_path', a.cover_path,
        'welcome_text', a.welcome_text,
        'configured', a.id is not null,
        'is_owner_preview', v_owner = v_me)
      from public.public_profiles p
      left join public.member_areas a on a.owner_id = p.uid
      where p.uid = v_owner
      limit 1),
    'continue', (
      select jsonb_build_object(
        'course_id', r.course_id,
        'course_title', r.course_title,
        'lesson_id', r.lesson_id,
        'lesson_title', r.lesson_title,
        'position_seconds', r.position_seconds,
        'last_seen_at', r.seen_at)
      from resume r
      where r.lesson_title is not null
      order by r.pri, r.seen_at desc nulls last
      limit 1),
    'my_products', coalesce((
      select jsonb_agg(jsonb_build_object(
          'course_id', c.id,
          'title', c.title,
          'cover_image_url', c.cover_image_url,
          'product_format', c.product_format,
          'lesson_count', c.lesson_count,
          'progress_percent', m.progress_percent,
          'enrollment_status', m.status)
        order by o.sort_key, o.created_at desc nulls last, c.id)
      from mine m
      join ordered o on o.course_id = m.course_id
      join public.courses c on c.id = m.course_id), '[]'::jsonb),
    -- Vitrine: so publicado, visivel e nao comprado, e so campos publicos.
    'more_products', coalesce((
      select jsonb_agg(jsonb_build_object(
          'course_id', c.id,
          'title', c.title,
          'cover_image_url', c.cover_image_url,
          'price_amount_minor', c.price_amount_minor,
          'currency', c.currency,
          'payment_type', c.payment_type,
          'sales_key', coalesce(c.title_key, c.id))
        order by o.sort_key, o.created_at desc nulls last, c.id)
      from ordered o
      join public.courses c on c.id = o.course_id
      where c.status = 'published' and o.visible
        and not exists (select 1 from mine m where m.course_id = o.course_id)), '[]'::jsonb)
  ) into v_home;
  return v_home;
end;
$function$;
revoke all on function public.get_member_area_home(text) from public, anon, service_role;
grant execute on function public.get_member_area_home(text) to authenticated;

-- Nome, tema, capa e boas-vindas da area de quem chama. Texto vazio = padrao.
create function public.save_my_member_area(
  p_name text,
  p_theme text,
  p_cover_path text,
  p_welcome_text text
)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.member_areas(owner_id, name, theme, cover_path, welcome_text)
  values (v_me, nullif(btrim(p_name), ''), coalesce(nullif(btrim(p_theme), ''), 'light'),
    nullif(btrim(p_cover_path), ''), nullif(btrim(p_welcome_text), ''))
  on conflict (owner_id) do update
    set name = excluded.name,
      theme = excluded.theme,
      cover_path = excluded.cover_path,
      welcome_text = excluded.welcome_text,
      updated_at = now();
end;
$function$;
revoke all on function public.save_my_member_area(text, text, text, text) from public, anon, service_role;
grant execute on function public.save_my_member_area(text, text, text, text) to authenticated;

-- A lista inteira, na ordem desejada: [{course_id, visible}]. Recusa tudo se
-- algum produto nao for de quem chama. Cria a area se ainda for virtual.
create function public.save_my_member_area_products(p_items jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_area uuid;
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500
    or exists (
      select 1 from jsonb_array_elements(p_items) i
      where jsonb_typeof(i) <> 'object'
        or jsonb_typeof(i -> 'course_id') is distinct from 'string'
        or (i ? 'visible' and jsonb_typeof(i -> 'visible') <> 'boolean'))
    or (select count(distinct i ->> 'course_id') from jsonb_array_elements(p_items) i)
      <> jsonb_array_length(p_items) then
    raise exception 'MEMBER_AREA_ITEMS_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
    left join public.courses c on c.id = i ->> 'course_id'
    where c.id is null or c.owner_id <> v_me
  ) then
    raise exception 'MEMBER_AREA_COURSE_NOT_OWNED' using errcode = '42501';
  end if;

  insert into public.member_areas(owner_id) values (v_me)
  on conflict (owner_id) do update set updated_at = now()
  returning id into v_area;
  -- Inclui linha de outra area para produto que agora e de quem chama.
  delete from public.member_area_products mp
  where mp.area_id = v_area
    or mp.course_id in (select i ->> 'course_id' from jsonb_array_elements(p_items) i);
  insert into public.member_area_products(area_id, course_id, position, visible)
  select v_area, t.i ->> 'course_id', (t.n - 1)::int, coalesce((t.i ->> 'visible')::boolean, true)
  from jsonb_array_elements(p_items) with ordinality as t(i, n);
end;
$function$;
revoke all on function public.save_my_member_area_products(jsonb) from public, anon, service_role;
grant execute on function public.save_my_member_area_products(jsonb) to authenticated;

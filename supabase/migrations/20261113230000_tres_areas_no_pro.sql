-- Mais de uma área de membros por professor (pacote 2c, decisão do dono,
-- 13/11/2026): Basic e Starter têm 1 área, Pro e Enterprise até 3.
--
-- A área principal é a de sempre (slug null), em /learn/areas/@usuario, e
-- continua podendo ser virtual (sem linha). As extras têm endereço curto
-- (slug), único por professor: /learn/areas/@usuario/slug.
--
-- Onde cada produto mora: na área cuja lista o tem (member_area_products,
-- course_id único: no máximo uma); fora de qualquer lista, na principal. Com
-- só a principal, nada muda para ninguém.
--
-- Quem entra numa área: o dono, ou quem tem matrícula ativa/concluída em
-- produto DAQUELA área. A comunidade da área segue a mesma régua (e continua
-- sem abrir para matrícula gratuita).
--
-- Plano caiu (Pro -> Starter com 3 áreas): nada some para o aluno. As extras
-- além do limite ficam no ar, mas travadas para o professor: não cria área
-- nova nem edita as travadas até voltar ao Pro. Apagar uma extra pode sempre
-- (os produtos dela voltam para a principal).
--
-- As funções que o app já chama ganham um parâmetro no fim, com padrão null =
-- área principal: o app publicado antes desta migration segue funcionando.

-- 1. A tabela ------------------------------------------------------------------
alter table public.member_areas drop constraint member_areas_owner_id_key;
alter table public.member_areas
  add column slug text check (slug is null or (
    slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' and slug <> 'community'));
-- Uma principal (slug null -> '') e um slug de cada por professor. Serve também
-- para achar as áreas de um professor.
create unique index member_areas_owner_slug_key on public.member_areas (owner_id, (coalesce(slug, '')));

-- 2. Limite por plano -----------------------------------------------------------
-- Espelha planEntitlements[*].quotas.memberAreas em src/domain/entitlements.ts.
create function public.member_area_limit_for_plan(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_plan_id, 'free')
    when 'pro'  then 3
    when 'plus' then 3
    else 1            -- free, basic e starter: só a principal
  end;
$$;
grant execute on function public.member_area_limit_for_plan(text) to anon, authenticated, service_role;

-- A principal sempre; uma extra só enquanto o plano cobre, pela ordem de criação.
create function public.member_area_editable(p_area_id uuid, p_owner text)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.member_areas a
    where a.id = p_area_id and a.owner_id = p_owner
      and (a.slug is null or (
        select count(*) from public.member_areas b
        where b.owner_id = a.owner_id and b.slug is not null
          and (b.created_at, b.id) <= (a.created_at, a.id))
        < public.member_area_limit_for_plan(
          (select u.current_plan_id from public.users u where u.uid = p_owner))));
$function$;
revoke all on function public.member_area_editable(uuid, text) from public, anon, authenticated, service_role;

-- A área que quem chama vai gravar: null = a principal (criada se ainda for
-- virtual). Recusa quem não é professor, sessão fraca, área de outro e área travada.
create function public.member_area_for_write(p_area_id uuid)
returns uuid
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_area uuid;
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_area_id is null then
    insert into public.member_areas(owner_id) values (v_me)
    on conflict (owner_id, (coalesce(slug, ''))) do update set updated_at = now()
    returning id into v_area;
    return v_area;
  end if;
  if not public.member_area_editable(p_area_id, v_me) then
    raise exception 'MEMBER_AREA_LOCKED' using errcode = '42501';
  end if;
  return p_area_id;
end;
$function$;
revoke all on function public.member_area_for_write(uuid) from public, anon, authenticated, service_role;

-- 3. Onde cada produto mora -----------------------------------------------------
-- Os produtos do professor numa área (slug null = principal), com a ordem e a
-- visibilidade dela. Linha de área de outro dono não conta: produto sem lista
-- própria mora na principal.
drop function public.get_member_area_home(text);
drop function public.member_area_product_order(text);
create function public.member_area_product_order(p_owner text, p_slug text)
returns table (course_id text, sort_key int, visible boolean, created_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, coalesce(x.position, 10000), coalesce(x.visible, true), c.created_at
  from public.courses c
  left join lateral (
    select mp.position, mp.visible, a.slug
    from public.member_area_products mp
    join public.member_areas a on a.id = mp.area_id and a.owner_id = p_owner
    where mp.course_id = c.id
  ) x on true
  where c.owner_id = p_owner
    and x.slug is not distinct from p_slug;
$function$;
revoke all on function public.member_area_product_order(text, text) from public, anon, authenticated, service_role;

-- 4. A tela do aluno --------------------------------------------------------------
-- Igual à anterior, com a área escolhida pelo slug. null também quando o slug
-- não existe ou quem chama não tem produto DESTA área.
create function public.get_member_area_home(p_area_ref text, p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_owner text;
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_home jsonb;
begin
  if v_me is null or not public.session_is_strong() then
    return null;
  end if;
  v_owner := public.resolve_member_area_owner(p_area_ref);
  if v_owner is null then
    return null;
  end if;
  if v_slug is not null and not exists (
    select 1 from public.member_areas a where a.owner_id = v_owner and a.slug = v_slug
  ) then
    return null;
  end if;
  if v_owner <> v_me and not exists (
    select 1 from public.enrollments e
    join public.member_area_product_order(v_owner, v_slug) o on o.course_id = e.course_id
    where e.user_id = v_me and e.status in ('active', 'completed')
  ) then
    return null;
  end if;

  with ordered as (
    select o.course_id, o.sort_key, o.visible, o.created_at
    from public.member_area_product_order(v_owner, v_slug) o
  ),
  mine as (
    select e.id as enrollment_id, e.course_id, e.last_lesson_id, e.updated_at,
      e.progress_percent, e.status
    from public.enrollments e
    join ordered o on o.course_id = e.course_id
    where e.user_id = v_me and e.status in ('active', 'completed')
  ),
  resume as (
    select x.course_id, x.lesson_id, x.position_seconds, x.seen_at, x.pri, c.title as course_title,
      jsonb_path_query_first(c.modules, '$[*].lessons[*] ? (@.id == $id).title',
        jsonb_build_object('id', x.lesson_id)) #>> '{}' as lesson_title
    from (
      select m.course_id, p.lesson_id, p.position_seconds, p.last_seen_at as seen_at, 0 as pri
      from mine m
      join public.lesson_playback p on p.enrollment_id = m.enrollment_id and p.user_id = v_me
      where m.status = 'active'
      union all
      select m.course_id, public.member_area_resume_lesson(c.modules, m.last_lesson_id), 0, m.updated_at, 1
      from mine m
      join public.courses c on c.id = m.course_id
      where m.status = 'active'
    ) x
    join public.courses c on c.id = x.course_id
  )
  select jsonb_build_object(
    'area', (
      select jsonb_build_object(
        'owner_id', v_owner,
        'username', p.username,
        'slug', v_slug,
        'creator_name', p.display_name,
        'creator_photo_url', p.photo_url,
        'name', coalesce(a.name, p.display_name),
        'theme', coalesce(a.theme, 'light'),
        'cover_path', a.cover_path,
        'welcome_text', a.welcome_text,
        'configured', a.id is not null,
        'is_owner_preview', v_owner = v_me)
      from public.public_profiles p
      left join public.member_areas a on a.owner_id = p.uid and a.slug is not distinct from v_slug
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
revoke all on function public.get_member_area_home(text, text) from public, anon, service_role;
grant execute on function public.get_member_area_home(text, text) to authenticated;

-- 5. A comunidade da área -----------------------------------------------------------
-- Mesma régua de antes, só que pelos produtos DA área (não mais de todo o professor).
create or replace function public.has_member_area_community_access(p_slug text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.session_is_strong() and exists (
    select 1
    from public.member_areas a
    join public.courses cc on cc.id = a.community_course_id and cc.owner_id = a.owner_id
      and cc.status = 'published' and cc.community_enabled
    cross join lateral public.member_area_product_order(a.owner_id, a.slug) o
    join public.enrollments e on e.course_id = o.course_id
    where a.community_course_id = public.resolve_course_reference(p_slug)
      and e.user_id = (select auth.uid())::text
      and e.status in ('active', 'completed')
      and e.source is distinct from 'free_course'
  );
$function$;

drop function public.get_member_area_community(text);
create function public.get_member_area_community(p_area_ref text, p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_owner text;
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_course text;
  v_title text;
begin
  if v_me is null or not public.session_is_strong() then
    return null;
  end if;
  v_owner := public.resolve_member_area_owner(p_area_ref);
  if v_owner is null then
    return null;
  end if;
  select c.id, c.title into v_course, v_title
  from public.member_areas a
  join public.courses c on c.id = a.community_course_id and c.owner_id = a.owner_id
    and c.status = 'published' and c.community_enabled
  where a.owner_id = v_owner and a.slug is not distinct from v_slug;
  if v_course is null then
    return null;
  end if;
  if v_owner <> v_me and not public.has_member_area_community_access(v_course) then
    return null;
  end if;
  return jsonb_build_object('course_id', v_course, 'title', v_title, 'is_owner', v_owner = v_me);
end;
$function$;
revoke all on function public.get_member_area_community(text, text) from public, anon, service_role;
grant execute on function public.get_member_area_community(text, text) to authenticated;

-- 6. O professor grava ----------------------------------------------------------------
drop function public.save_my_member_area(text, text, text, text);
create function public.save_my_member_area(
  p_name text,
  p_theme text,
  p_cover_path text,
  p_welcome_text text,
  p_area_id uuid default null
)
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
  v_area := public.member_area_for_write(p_area_id);
  update public.member_areas
  set name = nullif(btrim(p_name), ''),
    theme = coalesce(nullif(btrim(p_theme), ''), 'light'),
    cover_path = nullif(btrim(p_cover_path), ''),
    welcome_text = nullif(btrim(p_welcome_text), ''),
    updated_at = now()
  where id = v_area;
end;
$function$;
revoke all on function public.save_my_member_area(text, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.save_my_member_area(text, text, text, text, uuid) to authenticated;

-- A lista inteira da área, na ordem: [{course_id, visible}]. Numa extra, produto
-- que estava em outra área do professor muda para ela (menos de área travada);
-- o que sai da lista de uma extra volta para a principal. Na principal, produto
-- que mora numa extra fica onde está e é pulado: uma aba velha (ou o app de
-- antes desta migration, que manda todos os produtos) não esvazia as extras.
drop function public.save_my_member_area_products(jsonb);
create function public.save_my_member_area_products(p_items jsonb, p_area_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_area uuid;
  v_is_main boolean;
  v_items jsonb;
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  v_area := public.member_area_for_write(p_area_id);
  v_is_main := (select a.slug is null from public.member_areas a where a.id = v_area);
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
  if exists (
    select 1 from public.member_area_products mp
    join public.member_areas a on a.id = mp.area_id and a.owner_id = v_me
    where not v_is_main and mp.area_id <> v_area
      and mp.course_id in (select i ->> 'course_id' from jsonb_array_elements(p_items) i)
      and not public.member_area_editable(mp.area_id, v_me)
  ) then
    raise exception 'MEMBER_AREA_LOCKED' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.i order by t.n), '[]'::jsonb) into v_items
  from jsonb_array_elements(p_items) with ordinality as t(i, n)
  where not v_is_main
    or not exists (
      select 1 from public.member_area_products mp
      join public.member_areas a on a.id = mp.area_id and a.owner_id = v_me and a.slug is not null
      where mp.course_id = t.i ->> 'course_id');

  -- Inclui linha de outra área (deste ou de outro dono) para produto que agora
  -- é desta lista.
  delete from public.member_area_products mp
  where mp.area_id = v_area
    or mp.course_id in (select i ->> 'course_id' from jsonb_array_elements(v_items) i);
  insert into public.member_area_products(area_id, course_id, position, visible)
  select v_area, t.i ->> 'course_id', (t.n - 1)::int, coalesce((t.i ->> 'visible')::boolean, true)
  from jsonb_array_elements(v_items) with ordinality as t(i, n);
end;
$function$;
revoke all on function public.save_my_member_area_products(jsonb, uuid) from public, anon, service_role;
grant execute on function public.save_my_member_area_products(jsonb, uuid) to authenticated;

drop function public.set_my_member_area_community(text);
create function public.set_my_member_area_community(p_course_id text, p_area_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_area uuid;
  v_course text := nullif(btrim(coalesce(p_course_id, '')), '');
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  v_area := public.member_area_for_write(p_area_id);
  if v_course is not null and not exists (
    select 1 from public.courses c
    where c.id = v_course and c.owner_id = v_me
      and c.product_format = 'community' and c.community_enabled and c.status = 'published'
  ) then
    raise exception 'MEMBER_AREA_COMMUNITY_INVALID' using errcode = '22023';
  end if;
  update public.member_areas
  set community_course_id = v_course, updated_at = now()
  where id = v_area;
end;
$function$;
revoke all on function public.set_my_member_area_community(text, uuid) from public, anon, service_role;
grant execute on function public.set_my_member_area_community(text, uuid) to authenticated;

-- 7. Criar e apagar uma área extra -----------------------------------------------------
-- Endereço: letras minúsculas, números e hífen, até 40. 'community' é da rota.
create function public.create_my_member_area(p_name text, p_slug text)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_area uuid;
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' or v_slug = 'community' then
    raise exception 'MEMBER_AREA_SLUG_INVALID' using errcode = '22023';
  end if;
  -- Duas abas criando juntas: a segunda espera e conta a área da primeira.
  perform pg_advisory_xact_lock(hashtext('member_areas:' || v_me));
  if (select count(*) from public.member_areas a where a.owner_id = v_me and a.slug is not null) + 1
    >= public.member_area_limit_for_plan((select u.current_plan_id from public.users u where u.uid = v_me)) then
    raise exception 'MEMBER_AREA_LIMIT' using errcode = 'P0001';
  end if;
  -- Slug repetido: unique_violation (23505), que o app mostra como "endereço em uso".
  insert into public.member_areas(owner_id, slug, name)
  values (v_me, v_slug, nullif(btrim(p_name), ''))
  returning id into v_area;
  return v_area;
end;
$function$;
revoke all on function public.create_my_member_area(text, text) from public, anon, service_role;
grant execute on function public.create_my_member_area(text, text) to authenticated;

-- Só extra. Os produtos dela voltam para a principal.
create function public.delete_my_member_area(p_area_id uuid)
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
  delete from public.member_areas a
  where a.id = p_area_id and a.owner_id = v_me and a.slug is not null;
  if not found then
    raise exception 'MEMBER_AREA_NOT_FOUND' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function public.delete_my_member_area(uuid) from public, anon, service_role;
grant execute on function public.delete_my_member_area(uuid) to authenticated;

-- 8. Para onde o "Área de ..." leva -----------------------------------------------------
-- Dos produtos pedidos que quem chama comprou (ou é dono), os que moram numa
-- área extra: slug e nome dela. Produto fora da resposta mora na principal.
create function public.get_member_area_slugs(p_course_ids text[])
returns table (course_id text, slug text, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, a.slug, a.name
  from unnest((p_course_ids)[1:200]) as r(id)
  join public.courses c on c.id = r.id
  join public.member_area_products mp on mp.course_id = c.id
  join public.member_areas a on a.id = mp.area_id and a.owner_id = c.owner_id and a.slug is not null
  where public.session_is_strong()
    and (c.owner_id = (select auth.uid())::text or exists (
      select 1 from public.enrollments e
      where e.course_id = c.id and e.user_id = (select auth.uid())::text
        and e.status in ('active', 'completed')));
$function$;
revoke all on function public.get_member_area_slugs(text[]) from public, anon, service_role;
grant execute on function public.get_member_area_slugs(text[]) to authenticated;

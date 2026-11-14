-- Comunidade da área inteira (área de membros, pacote 2 — decisão do dono,
-- 13/11/2026).
--
-- O professor escolhe UM produto do tipo community, publicado e com a
-- comunidade ligada, como comunidade da área. Quem tem matrícula ativa ou
-- concluída em QUALQUER produto desse professor entra nela: lê, posta, comenta,
-- curte, denuncia e aparece em "online". Matrícula gratuita (source
-- 'free_course') NÃO abre: senão um brinde grátis daria a comunidade paga a
-- qualquer um. As comunidades por produto continuam como estão.
--
-- A comunidade da área NÃO abre aula: courses_select_enrolled, course_events_*,
-- course_event_rsvps_* e lesson_is_released seguem em
-- has_enrollment_for_course_slug. Só as regras da comunidade trocam para
-- has_community_access.
--
--   1. member_areas.community_course_id (escrita só por set_my_member_area_community).
--   2. has_member_area_community_access / has_community_access.
--   3. As 9 regras da comunidade (posts, comentários, curtidas, denúncia e
--      presença em tempo real) e o gatilho community_reports_trusted_fields.
--   4. set_my_member_area_community e get_member_area_community.

-- 1. A escolha ------------------------------------------------------------------
alter table public.member_areas
  add column if not exists community_course_id text references public.courses(id) on delete set null;

-- 2. Quem entra ------------------------------------------------------------------
-- Dono da área = dono do produto comunidade: se o produto mudar de dono, a
-- escolha deixa de valer em vez de abrir a comunidade de outra pessoa. Produto
-- despublicado ou com a comunidade desligada também deixa de valer.
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
    join public.courses c on c.owner_id = a.owner_id
    join public.enrollments e on e.course_id = c.id
    where a.community_course_id = public.resolve_course_reference(p_slug)
      and e.user_id = (select auth.uid())::text
      and e.status in ('active', 'completed')
      and e.source is distinct from 'free_course'
  );
$function$;
revoke all on function public.has_member_area_community_access(text) from public;
grant execute on function public.has_member_area_community_access(text) to anon, authenticated, service_role;

-- invoker: as duas que ela chama já são definer e já checam a sessão.
create or replace function public.has_community_access(p_slug text)
returns boolean
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select public.has_enrollment_for_course_slug(p_slug)
    or public.has_member_area_community_access(p_slug);
$function$;
revoke all on function public.has_community_access(text) from public;
grant execute on function public.has_community_access(text) to anon, authenticated, service_role;

-- 3. As regras da comunidade -------------------------------------------------------
-- Mesmo texto de antes, só has_enrollment_for_course_slug -> has_community_access.
alter policy community_posts_select_enrolled on public.community_posts
  using (public.is_admin() or public.has_community_access(course_slug));

alter policy community_posts_insert_enrolled on public.community_posts
  with check (
    author_id = ((select auth.uid()))::text
    and public.has_community_access(course_slug)
    and coalesce(pinned, false) = false
    and exists (select from public.courses c where c.id = community_posts.course_slug and c.community_enabled)
  );

alter policy community_comments_select_enrolled on public.community_comments
  using (public.has_community_access(course_slug));

alter policy community_comments_insert_enrolled on public.community_comments
  with check (
    author_id = ((select auth.uid()))::text
    and public.has_community_access(course_slug)
    and exists (
      select 1 from public.community_posts p
      where p.id = community_comments.post_id and p.course_slug = community_comments.course_slug)
  );

alter policy community_post_likes_select_enrolled on public.community_post_likes
  using (exists (
    select 1 from public.community_posts p
    where p.id = community_post_likes.post_id and public.has_community_access(p.course_slug)));

alter policy community_post_likes_insert_owner on public.community_post_likes
  with check (
    liker_id = ((select auth.uid()))::text
    and exists (
      select 1 from public.community_posts p
      where p.id = community_post_likes.post_id and public.has_community_access(p.course_slug))
  );

alter policy community_reports_insert_reporter on public.community_reports
  with check (
    (select auth.uid()) is not null
    and reporter_id = ((select auth.uid()))::text
    and status = 'open'
    and post_id is not null
    and target_type is not null
    and public.has_community_access(course_slug)
    and not public.is_target_author(target_type, post_id)
  );

alter policy community_presence_read on realtime.messages
  using (
    extension = 'presence'
    and (select realtime.topic()) like 'community-presence:%'
    and (select public.account_session_allowed())
    and (
      (select public.owns_course_reference(split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)))
      or (select public.has_community_access(split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)))
      or (select public.is_admin())
    )
  );

alter policy community_presence_write on realtime.messages
  with check (
    extension = 'presence'
    and (select realtime.topic()) like 'community-presence:%'
    and (select public.account_session_allowed())
    and (
      (select public.owns_course_reference(split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)))
      or (select public.has_community_access(split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)))
      or (select public.is_admin())
    )
  );

-- Denúncia: quem vê o post pode denunciar. Igual à versão anterior, trocando
-- só a checagem de quem vê.
create or replace function public.community_reports_trusted_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_author_id text;
  v_author_name text;
begin
  -- coalesce: com a configuracao ausente, "not (false or null)" daria null e
  -- o if pularia as duas checagens.
  if not (public.is_service_role()
          or coalesce(current_setting('skillset.trusted_write', true) = 'on', false)) then
    if new.reporter_id is distinct from (select auth.uid())::text then
      raise exception 'community_reports: the reporter must be the caller'
        using errcode = '42501';
    end if;
    if not (public.has_community_access(new.course_slug)
            or public.owns_course_reference(new.course_slug)) then
      raise exception 'community_reports: the reporter cannot see this post'
        using errcode = '42501';
    end if;
  end if;

  if new.target_type = 'comment' and new.comment_id is not null then
    select c.author_id, c.author_name into v_author_id, v_author_name
      from public.community_comments c
     where c.id = new.comment_id and c.post_id = new.post_id;
  elsif new.target_type = 'post' and new.comment_id is null then
    select p.author_id, p.author_name into v_author_id, v_author_name
      from public.community_posts p
     where p.id = new.post_id;
  end if;
  if v_author_id is null then
    raise exception 'community_reports: the reported item is not in this post'
      using errcode = '42501';
  end if;
  if v_author_id = new.reporter_id then
    raise exception 'community_reports: nobody reports what they wrote'
      using errcode = '42501';
  end if;

  new.target_author_id := v_author_id;
  new.target_author_name := v_author_name;
  select left(coalesce(nullif(btrim(u.display_name), ''), 'SkillsetMind member'), 120), u.email
    into new.reporter_name, new.reporter_email
    from public.users u
   where u.uid = new.reporter_id;
  new.reporter_name := coalesce(new.reporter_name, 'SkillsetMind member');
  new.created_at := now();
  new.updated_at := now();

  if new.status = 'open' then
    -- Duas abas mandando juntas: a segunda espera a primeira terminar e ve a
    -- linha dela.
    perform pg_advisory_xact_lock(hashtext(
      'community_reports:' || new.reporter_id || ':' || new.post_id || ':' || coalesce(new.comment_id, '')));
    if exists (
      select 1 from public.community_reports r
       where r.status = 'open'
         and r.reporter_id = new.reporter_id
         and r.post_id = new.post_id
         and r.comment_id is not distinct from new.comment_id
    ) then
      raise exception 'COMMUNITY_REPORT_DUPLICATE' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$function$;

-- 4. Escolher e ler -------------------------------------------------------------
-- Vazio = sem comunidade da área. Só um produto community do próprio professor,
-- publicado e com a comunidade ligada. Cria a área se ainda for virtual.
create or replace function public.set_my_member_area_community(p_course_id text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_course text := nullif(btrim(coalesce(p_course_id, '')), '');
begin
  if v_me is null or not public.is_teacher() or not public.session_is_strong() then
    raise exception 'MEMBER_AREA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_course is not null and not exists (
    select 1 from public.courses c
    where c.id = v_course and c.owner_id = v_me
      and c.product_format = 'community' and c.community_enabled and c.status = 'published'
  ) then
    raise exception 'MEMBER_AREA_COMMUNITY_INVALID' using errcode = '22023';
  end if;
  insert into public.member_areas(owner_id, community_course_id) values (v_me, v_course)
  on conflict (owner_id) do update
    set community_course_id = excluded.community_course_id,
      updated_at = now();
end;
$function$;
revoke all on function public.set_my_member_area_community(text) from public, anon, service_role;
grant execute on function public.set_my_member_area_community(text) to authenticated;

-- A comunidade da área de "@usuario" (ou uid), para o dono e para quem tem
-- matrícula em produto dele. null para o resto, ou sem comunidade escolhida.
create or replace function public.get_member_area_community(p_area_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me text := auth.uid()::text;
  v_owner text;
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
  where a.owner_id = v_owner;
  if v_course is null then
    return null;
  end if;
  if v_owner <> v_me and not public.has_member_area_community_access(v_course) then
    return null;
  end if;
  return jsonb_build_object('course_id', v_course, 'title', v_title, 'is_owner', v_owner = v_me);
end;
$function$;
revoke all on function public.get_member_area_community(text) from public, anon, service_role;
grant execute on function public.get_member_area_community(text) to authenticated;

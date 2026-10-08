-- Apagar produto sem comprador apaga TUDO o que e dele, e deixa os arquivos e
-- videos marcados para uma limpeza que so roda depois do commit.
--
-- O que falhava: post do proprio professor na comunidade (inclusive comentario
-- de aula) e convite de acesso pendente tem chave estrangeira sem cascata para
-- courses (20260906020000:385-388, 20260906010000:4). Apagar morria num 23503
-- e a tela dizia "nao deu". A funcao do admin nem tinha o remendo de sessao ao
-- vivo do #495 (20261007010000:83-102 so tocou a do professor).
-- O que vazava: capa, materiais e imagens da pagina de venda no Storage, e os
-- videos na Bunny. Nenhum codigo os apagava; o curso sumia e o custo ficava.
--
-- Como fica:
--   1. course_deletions e a fila da limpeza. Um gatilho BEFORE DELETE em
--      courses grava a linha com os videos da Bunny (e o recibo de cada um)
--      ANTES de course_assets cair em cascata. Toda forma de apagar curso
--      passa por ele, e a linha so existe se o DELETE fez commit.
--   2. clear_course_for_delete apaga os filhos sem cascata, na ordem certa.
--      Dono e admin chamam a mesma funcao.
--   3. /api/cron/course-cleanup (service role) le a fila e apaga os arquivos
--      de courses/<id>/ e os videos com recibo deste curso, 24 h depois.
-- Curso com matricula, pedido OU assinatura continua sendo ARQUIVADO.

-- 1. A fila -----------------------------------------------------------------
create table if not exists public.course_deletions (
  course_id    text primary key,
  owner_id     text not null,
  title        text not null default '',
  -- [{videoId, receipt, ownerId}] copiado de course_assets antes da cascata.
  -- receipt = storage_path 'bunny/<videoId>/<hmac>' (src/lib/bunny/server.ts).
  bunny_assets jsonb not null default '[]'::jsonb,
  status       text not null default 'pending'
               check (status in ('pending', 'done', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  requested_at timestamptz not null default now(),
  finished_at  timestamptz
);

comment on table public.course_deletions is
  'Produto apagado esperando a limpeza de arquivos (Storage) e videos (Bunny). Escrita so pelo gatilho de courses e pelo service role.';

alter table public.course_deletions enable row level security;

-- Sem policy permissiva: so o service role (que ignora RLS) le e escreve. O
-- dono ve as proprias linhas pela list_my_courses_being_deleted, abaixo.
-- Toda tabela com RLS carrega a trava de conta suspensa
-- (20260910030000:44-56; o smoke de la reprova tabela sem ela).
drop policy if exists account_access_guard on public.course_deletions;
create policy account_access_guard on public.course_deletions
  as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

revoke all on public.course_deletions from public, anon, authenticated;
grant all on public.course_deletions to service_role;

-- 2. O gatilho que grava a fila ----------------------------------------------
-- BEFORE DELETE: course_assets ainda existe aqui; depois do DELETE a cascata
-- leva junto a unica lista dos videos da Bunny. Se o DELETE falhar, a linha
-- da fila volta junto (mesma transacao).
create or replace function public.course_deletions_record()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.course_deletions (course_id, owner_id, title, bunny_assets)
  values (
    old.id,
    -- coalesce: um owner nulo nunca pode impedir o DELETE.
    coalesce(old.owner_id, ''),
    coalesce(old.title, ''),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'videoId', a.bunny_video_id,
               'receipt', a.storage_path,
               'ownerId', a.owner_id))
        from public.course_assets a
       where a.course_id = old.id
         and a.bunny_video_id is not null
    ), '[]'::jsonb)
  )
  -- Id reaproveitado e apagado de novo: soma os videos que ainda nao sairam.
  on conflict (course_id) do update
     set owner_id     = excluded.owner_id,
         title        = excluded.title,
         bunny_assets = case when course_deletions.status = 'done'
                             then excluded.bunny_assets
                             else course_deletions.bunny_assets || excluded.bunny_assets end,
         status       = 'pending',
         attempts     = 0,
         last_error   = null,
         requested_at = now(),
         finished_at  = null;
  return old;
end;
$function$;

revoke all on function public.course_deletions_record() from public, anon, authenticated;

drop trigger if exists courses_record_deletion on public.courses;
create trigger courses_record_deletion
  before delete on public.courses
  for each row execute function public.course_deletions_record();

-- 3. Os filhos sem cascata, numa funcao so ---------------------------------
-- So roda no galho sem comprador: estas linhas so podem ser do proprio
-- professor (posts e respostas dele, sessoes, convites ainda nao aceitos) ou
-- listas de desejo, que nao tem chave estrangeira e virariam item morto.
create or replace function public.clear_course_for_delete(p_course_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key text;
begin
  select title_key into v_key from public.courses where id = p_course_id;

  delete from public.community_reports where course_slug = p_course_id;
  delete from public.community_posts where course_slug = p_course_id;     -- respostas e curtidas em cascata
  delete from public.community_comments where course_slug = p_course_id;  -- defensivo
  delete from public.course_events where course_id = p_course_id;         -- RSVPs em cascata
  delete from public.course_access_grants where course_id = p_course_id;
  delete from public.wishlists where course_id = p_course_id;
  delete from public.course_lesson_content where course_id = p_course_id;
  -- title_key e um unique global: ficaria queimado para sempre.
  if v_key is not null then
    delete from public.course_title_keys where title_key = v_key;
  end if;
end;
$function$;

revoke all on function public.clear_course_for_delete(text) from public, anon, authenticated;

-- 4. A funcao do professor --------------------------------------------------
create or replace function public.delete_or_archive_own_course(p_course_id text)
returns jsonb
language plpgsql
security definer
-- pg_temp por ULTIMO (mesmo pin de 20260908120000:24-27).
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_slug text;
  v_enrollments integer;
  v_orders integer;
  v_subscriptions integer;
begin
  perform public.require_strong_session();

  if v_uid is null or not public.is_teacher() then
    raise exception 'Sign in as a creator before deleting a course.';
  end if;

  -- FOR UPDATE: um checkout gravando pedido agora trava a mesma linha (a FK
  -- de orders pega KEY SHARE), entao a contagem abaixo nao envelhece entre o
  -- SELECT e o DELETE.
  select owner_id, slug into v_owner, v_slug
    from public.courses
   where id = p_course_id
     for update;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can delete it.';
  end if;

  -- Matricula e pedido de QUALQUER status contam (20260908120000:54-58):
  -- reembolsada ou pendente continua sendo registro de alguem. Assinatura
  -- tambem e comprador; a FK dela aponta para o SLUG.
  select count(*) into v_enrollments from public.enrollments where course_id = p_course_id;
  select count(*) into v_orders from public.orders where course_id = p_course_id;
  select count(*) into v_subscriptions
    from public.course_subscriptions s
   where s.course_id = p_course_id or s.course_slug = v_slug;

  if v_enrollments = 0 and v_orders = 0 and v_subscriptions = 0 then
    perform public.clear_course_for_delete(p_course_id);
    -- O gatilho courses_record_deletion grava a fila da limpeza.
    delete from public.courses where id = p_course_id;
    return jsonb_build_object('outcome', 'deleted');
  end if;

  -- status e coluna congelada; janela local a transacao (publish_teacher_course).
  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses
     set status = 'inactive',
         review_note = null,
         updated_at = now()
   where id = p_course_id;

  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object(
    'outcome', 'archived',
    'enrollments', v_enrollments,
    'orders', v_orders,
    'subscriptions', v_subscriptions
  );
end;
$function$;

comment on function public.delete_or_archive_own_course(text) is
  'Exclui o proprio curso quando ele nunca teve matricula, pedido nem assinatura (com os filhos, e a fila da limpeza pelo gatilho); caso contrario arquiva (status inactive). Nunca apaga curso com comprador.';

revoke execute on function public.delete_or_archive_own_course(text) from public, anon;
grant execute on function public.delete_or_archive_own_course(text) to authenticated, service_role;

-- 5. A funcao do admin, pelo mesmo caminho ---------------------------------
create or replace function public.delete_course_as_admin(p_course_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_title text;
  v_slug text;
begin
  -- Mesma barreira que 20260906020000:16-43 injetou.
  perform public.require_strong_session();

  if v_uid is null or not public.is_admin() then
    raise exception 'Only an administrator can delete this course.';
  end if;

  select owner_id, title, slug into v_owner, v_title, v_slug
    from public.courses
   where id = p_course_id
     for update;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;

  if exists (select 1 from public.enrollments where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has enrollments.';
  end if;
  if exists (select 1 from public.orders where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has orders.';
  end if;
  if exists (
    select 1 from public.course_subscriptions s
     where s.course_id = p_course_id or s.course_slug = v_slug
  ) then
    raise exception 'Cannot delete a course that has subscriptions.';
  end if;

  perform public.clear_course_for_delete(p_course_id);
  delete from public.courses where id = p_course_id;

  begin
    perform public.log_audit_event(
      p_action => 'COURSE_DELETED_BY_ADMIN',
      p_actor_email => coalesce((select email from public.users where uid = v_uid), v_uid),
      p_actor_id => v_uid,
      p_metadata => jsonb_build_object('title', v_title, 'ownerId', v_owner),
      p_summary => 'Admin deleted course ' || p_course_id,
      p_target_id => p_course_id,
      p_target_type => 'course'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true);
end;
$function$;

revoke execute on function public.delete_course_as_admin(text) from public, anon;
grant execute on function public.delete_course_as_admin(text) to authenticated, service_role;

-- 6. A lista de arquivos para a limpeza (so service role) ------------------
-- O Storage nao e exposto pelo PostgREST; uma consulta aqui troca dezenas de
-- list() recursivos por uma. As travas ficam no banco, perto do dado:
--   - id so com letras, numeros, '-' e '_': uma barra no id faria o prefixo
--     cair dentro da pasta de OUTRO curso;
--   - precisa existir linha na fila para este id;
--   - se um curso com este id voltou a existir (insert direto escolhe o id,
--     20260809040000_rls_baseline_snapshot.sql:436-439), a pasta agora e
--     dele: recusa;
--   - prefixo com a barra final: 'courses/abc/' nunca casa 'courses/abc-2/'.
create or replace function public.course_storage_objects_for_cleanup(p_course_id text)
returns table (object_bucket text, object_name text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_service_role() then
    raise exception 'Service role only.' using errcode = '42501';
  end if;
  if p_course_id is null or p_course_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' then
    raise exception 'Unsafe course id.';
  end if;
  if not exists (select 1 from public.course_deletions d where d.course_id = p_course_id) then
    raise exception 'No deletion was requested for this course.';
  end if;
  if exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'Course id is in use again.';
  end if;

  return query
    select o.bucket_id::text, o.name::text
      from storage.objects o
     where o.bucket_id in ('public-media', 'course-content')
       and starts_with(o.name, 'courses/' || p_course_id || '/')
     order by o.bucket_id, o.name;
end;
$function$;

revoke all on function public.course_storage_objects_for_cleanup(text) from public, anon, authenticated;
grant execute on function public.course_storage_objects_for_cleanup(text) to service_role;

-- 7. O selo "Em exclusao" na lista de produtos -----------------------------
-- O dono le so as proprias linhas ainda nao limpas, e so tres colunas.
-- Sessao fraca (falta o segundo fator) ou conta suspensa: lista vazia.
create or replace function public.list_my_courses_being_deleted()
returns table (course_id text, title text, requested_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select d.course_id, d.title, d.requested_at
    from public.course_deletions d
   where d.owner_id = (select auth.uid())::text
     and d.status <> 'done'
     and (select public.session_is_strong())
   order by d.requested_at desc
   limit 20;
$function$;

revoke all on function public.list_my_courses_being_deleted() from public, anon;
grant execute on function public.list_my_courses_being_deleted() to authenticated, service_role;

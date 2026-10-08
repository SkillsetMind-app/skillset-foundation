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
--   3. /api/cron/course-cleanup (service role) le a fila e, a partir de um dia
--      depois, apaga de hora em hora, em lotes, os arquivos de courses/<id>/ e
--      os videos com recibo deste curso.
-- Curso com matricula, pedido OU assinatura continua sendo ARQUIVADO.
--
-- Segunda rodada (revisao do PR #507), no mesmo arquivo porque ele ainda nao
-- foi aplicado em lugar nenhum:
--   - status: pending (na fila, inclusive tentando de novo), done, failed (5
--     tentativas, a equipe foi avisada) e cancelled (a equipe parou a limpeza:
--     "apaguei o produto errado", docs/COMO-TRABALHAR.md). O selo da lista do
--     professor so aparece em pending;
--   - id escolhido a mao: um gatilho recusa criar (ou renomear para) um curso
--     com id que ainda esta na fila; a lista de arquivos so traz objeto criado
--     enquanto o curso existia (entre courses.created_at e o pedido);
--   - arquivo "emprestado": objeto que outra linha viva cita (capa, pagina de
--     venda, texto de aula, perfil, configuracao) vem marcado in_use e fica;
--   - video: conferido de novo logo antes de cada DELETE da Bunny (fila ainda
--     pending, id nao voltou, nenhuma linha viva cita o video);
--   - delete_or_archive_own_course trava so a linha do proprio dono;
--   - delete_teacher_course_draft (o app nao chama) perde o EXECUTE do cliente;
--   - lock_timeout: o gatilho em courses pega trava forte na tabela; esperar
--     uma transacao longa travaria a loja inteira junto.
begin;
set local lock_timeout = '5s';

-- 1. A fila -----------------------------------------------------------------
create table if not exists public.course_deletions (
  course_id         text primary key,
  owner_id          text not null,
  -- Vira '' quando a limpeza termina (done): fica so id e contagens.
  title             text not null default '',
  -- [{videoId, receipt, ownerId}] copiado de course_assets antes da cascata.
  -- receipt = storage_path 'bunny/<videoId>/<hmac>' (src/lib/bunny/server.ts).
  -- Cada video apagado sai daqui: e o progresso salvo entre uma hora e outra.
  bunny_assets      jsonb not null default '[]'::jsonb,
  -- courses.created_at do curso apagado: arquivo mais velho que o curso nao e
  -- dele (pasta orfa que um id escolhido a mao "adotou").
  course_created_at timestamptz,
  status            text not null default 'pending'
                    check (status in ('pending', 'done', 'failed', 'cancelled')),
  attempts          integer not null default 0,
  -- Voltas seguidas que estouraram o tempo sem apagar nada; 3 = 1 tentativa.
  stalled_runs      integer not null default 0,
  last_error        text,
  last_progress_at  timestamptz,
  -- No fim: {keptFiles, skippedNoReceipt: [videoId], inUseVideos: [videoId]}.
  result            jsonb not null default '{}'::jsonb,
  requested_at      timestamptz not null default now(),
  finished_at       timestamptz
);

comment on table public.course_deletions is
  'Produto apagado esperando a limpeza de arquivos (Storage) e videos (Bunny). Escrita so pelo gatilho de courses e pelo service role. status cancelled = a equipe parou a limpeza (docs/COMO-TRABALHAR.md).';

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
  insert into public.course_deletions (course_id, owner_id, title, bunny_assets, course_created_at)
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
    ), '[]'::jsonb),
    old.created_at
  )
  -- Id apagado de novo. So acontece depois de done ou cancelled (o gatilho de
  -- INSERT abaixo recusa recriar antes): a fila antiga nao volta. Cancelled
  -- quer dizer "guarde": os videos daquela vez nunca entram na conta nova.
  on conflict (course_id) do update
     set owner_id          = excluded.owner_id,
         title             = excluded.title,
         bunny_assets      = case when course_deletions.status in ('done', 'cancelled')
                                  then excluded.bunny_assets
                                  else course_deletions.bunny_assets || excluded.bunny_assets end,
         course_created_at = excluded.course_created_at,
         status            = 'pending',
         attempts          = 0,
         stalled_runs      = 0,
         last_error        = null,
         last_progress_at  = null,
         result            = '{}'::jsonb,
         requested_at      = now(),
         finished_at       = null;
  return old;
end;
$function$;

revoke all on function public.course_deletions_record() from public, anon, authenticated;

drop trigger if exists courses_record_deletion on public.courses;
create trigger courses_record_deletion
  before delete on public.courses
  for each row execute function public.course_deletions_record();

-- 2b. Id escolhido a mao ------------------------------------------------------
-- O cliente escolhe o id no INSERT (GRANT ALL em courses, a policy de insert
-- nao limita o id). Recriar um id ainda na fila faria de quem recriou o "dono"
-- da pasta: leria os materiais privados do dono anterior e veria a limpeza
-- apagar o que ele subiu. Enquanto a fila nao terminou (pending ou failed), o
-- id fica reservado. O slug nao entra: os arquivos usam so o id.
create or replace function public.courses_refuse_id_being_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id then
      return new;
    end if;
  end if;
  if exists (
    select 1 from public.course_deletions d
     where d.course_id = new.id
       and d.status not in ('done', 'cancelled')
  ) then
    raise exception 'This course id belongs to a product that is being deleted.'
      using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function public.courses_refuse_id_being_deleted() from public, anon, authenticated;

drop trigger if exists courses_refuse_id_being_deleted on public.courses;
create trigger courses_refuse_id_being_deleted
  before insert or update of id on public.courses
  for each row execute function public.courses_refuse_id_being_deleted();

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
  -- SELECT e o DELETE. O dono vai no WHERE: quem nao e dono nem trava a linha
  -- de outra pessoa nem descobre se o id existe (uma mensagem so).
  select slug into v_slug
    from public.courses
   where id = p_course_id and owner_id = v_uid
     for update;
  if not found then
    raise exception 'Course not found.';
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

-- 6. Quem ainda cita um arquivo ou um video ---------------------------------
-- Linhas vivas (como texto) que contem p_needle: caminho de arquivo, URL
-- publica (que contem o caminho) ou id de video da Bunny. A linha inteira vira
-- texto, entao nenhuma coluna nova escapa: capa, miniatura e capas de modulo
-- (courses), materiais copiados (course_assets), pagina de venda
-- (course_landings), texto de aula (course_lesson_content), ofertas, sessoes,
-- posts, perfis (users, public_profiles) e configuracao da plataforma
-- (platform_settings, a vitrine). Nao ha tabela de biblioteca de midia.
-- ponytail: varre essas tabelas inteiras, uma vez por produto e por volta.
-- Teto: tabelas de milhares de linhas. Passou disso, indice de trigramas.
-- Sem security definer: so e chamada de dentro das funcoes abaixo.
create or replace function public.course_cleanup_references(p_needle text)
returns setof text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select r::text from public.courses r where strpos(r::text, p_needle) > 0
  union all select r::text from public.course_assets r where strpos(r::text, p_needle) > 0
  union all select r::text from public.course_landings r where strpos(r::text, p_needle) > 0
  union all select r::text from public.course_lesson_content r where strpos(r::text, p_needle) > 0
  union all select r::text from public.product_offers r where strpos(r::text, p_needle) > 0
  union all select r::text from public.course_events r where strpos(r::text, p_needle) > 0
  union all select r::text from public.community_posts r where strpos(r::text, p_needle) > 0
  union all select r::text from public.users r where strpos(r::text, p_needle) > 0
  union all select r::text from public.public_profiles r where strpos(r::text, p_needle) > 0
  union all select r::text from public.platform_settings r where strpos(r::text, p_needle) > 0;
$function$;

revoke all on function public.course_cleanup_references(text) from public, anon, authenticated;

-- 7. A lista de arquivos para a limpeza (so service role) ------------------
-- O Storage nao e exposto pelo PostgREST; uma consulta aqui troca dezenas de
-- list() recursivos por uma. As travas ficam no banco, perto do dado:
--   - id so com letras, numeros, '-' e '_': uma barra no id faria o prefixo
--     cair dentro da pasta de OUTRO curso;
--   - precisa existir linha pending na fila para este id (cancelled para tudo);
--   - se um curso com este id voltou a existir, a pasta agora e dele: recusa;
--   - prefixo com a barra final: 'courses/abc/' nunca casa 'courses/abc-2/';
--   - so objeto criado enquanto o curso existia: depois de courses.created_at
--     (pasta orfa adotada por id escolhido a mao) e ate o pedido;
--   - in_use: outra linha viva cita o arquivo (a rotina nao apaga).
create or replace function public.course_storage_objects_for_cleanup(p_course_id text)
returns table (object_bucket text, object_name text, in_use boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.course_deletions;
begin
  if not public.is_service_role() then
    raise exception 'Service role only.' using errcode = '42501';
  end if;
  if p_course_id is null or p_course_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' then
    raise exception 'Unsafe course id.';
  end if;
  select * into v_job from public.course_deletions d where d.course_id = p_course_id;
  if not found then
    raise exception 'No deletion was requested for this course.';
  end if;
  if v_job.status <> 'pending' then
    raise exception 'This deletion is not pending.';
  end if;
  if exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'Course id is in use again.';
  end if;

  return query
    with refs as materialized (
      select t from public.course_cleanup_references('courses/' || p_course_id || '/') t
    )
    select o.bucket_id::text, o.name::text,
           exists (select 1 from refs where strpos(refs.t, o.name) > 0)
      from storage.objects o
     where o.bucket_id in ('public-media', 'course-content')
       and starts_with(o.name, 'courses/' || p_course_id || '/')
       and o.created_at <= v_job.requested_at
       and (v_job.course_created_at is null or o.created_at >= v_job.course_created_at)
     order by 1, 2;
end;
$function$;

revoke all on function public.course_storage_objects_for_cleanup(text) from public, anon, authenticated;
grant execute on function public.course_storage_objects_for_cleanup(text) to service_role;

-- 8. Um video pode sair? (so service role) ---------------------------------
-- A rotina pergunta logo antes de CADA DELETE da Bunny, nao uma vez no comeco:
-- a fila ainda pending (a equipe pode ter cancelado), o id nao voltou a
-- existir, e nenhuma linha viva cita o video (aula de outro curso, material
-- copiado). O recibo HMAC continua conferido na rotina.
create or replace function public.course_cleanup_video_deletable(p_course_id text, p_video_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_service_role() then
    raise exception 'Service role only.' using errcode = '42501';
  end if;
  if coalesce(p_video_id, '') !~ '^[A-Za-z0-9_-]+$' then
    return false;
  end if;
  return exists (
           select 1 from public.course_deletions d
            where d.course_id = p_course_id and d.status = 'pending')
     and not exists (select 1 from public.courses c where c.id = p_course_id)
     and not exists (select 1 from public.course_cleanup_references(p_video_id));
end;
$function$;

revoke all on function public.course_cleanup_video_deletable(text, text) from public, anon, authenticated;
grant execute on function public.course_cleanup_video_deletable(text, text) to service_role;

-- 9. O selo "Em exclusao" na lista de produtos -----------------------------
-- O dono le so as proprias linhas ainda na fila (pending), e so tres colunas.
-- failed (a equipe foi avisada) e cancelled nao mostram selo para sempre.
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
     and d.status = 'pending'
     and (select public.session_is_strong())
   order by d.requested_at desc
   limit 20;
$function$;

revoke all on function public.list_my_courses_being_deleted() from public, anon;
grant execute on function public.list_my_courses_being_deleted() to authenticated, service_role;

-- 10. A porta antiga ---------------------------------------------------------
-- delete_teacher_course_draft (20260716000100:441-477) nao conta comprador nem
-- limpa os filhos. O app nao a chama desde 20260908120000
-- (src/lib/data/teacher-courses.ts usa delete_or_archive_own_course).
revoke execute on function public.delete_teacher_course_draft(text) from public, anon, authenticated;

commit;

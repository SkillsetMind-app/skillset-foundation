-- O dono do curso modera a comunidade do proprio curso.
--
-- Antes: apagar post ou comentario era so do autor ou do admin
-- (20260809040000_rls_baseline_snapshot.sql:167-172 e :215-220). O professor
-- via spam no curso dele e nao tinha o que fazer. Desafixar ja era permitido
-- pelo banco (20260906020000_security_boundaries.sql:215-247); faltava so o
-- botao.
--
-- owns_course_reference ja exige papel de professor, sessao forte (segundo
-- fator) e resolve id/slug para o id canonico (20260906020000:187-199). As
-- policies restritivas (strong_session_*, account_access_guard) continuam
-- valendo por cima destas. Para apagar, a linha tambem precisa ser visivel:
-- as policies de leitura do dono (community_*_select_course_teacher) usam a
-- mesma funcao.
--
-- Segunda rodada (revisao do PR #505), no mesmo arquivo porque ele ainda nao
-- foi aplicado em lugar nenhum:
--   - o dono muda so pinned, accepted_comment_id e updated_at no post de outra
--     pessoa (o guard deixava reescrever title, lesson_id e lesson_title);
--   - denuncia: o banco preenche o autor denunciado, nome e e-mail de quem
--     denuncia e a data; a resposta tem de ser do post; quem denuncia tem de
--     enxergar o post; uma denuncia aberta por pessoa e alvo;
--   - a data de post e de resposta e a do servidor (vinha do navegador);
--   - post antigo com pinned nulo vira false.
--
-- Nada e apagado. O unico dado escrito e o pinned nulo -> false.
-- Idempotente: drop ... if exists + create, create or replace.

-- Vale dentro de transacao (begin ... commit, ou psql --single-transaction).
-- No psql -f puro e so um aviso.
set local lock_timeout = '5s';

drop policy if exists community_posts_delete_course_owner on public.community_posts;
create policy community_posts_delete_course_owner on public.community_posts
  as permissive for delete to authenticated
  using (public.owns_course_reference(course_slug));

drop policy if exists community_comments_delete_course_owner on public.community_comments;
create policy community_comments_delete_course_owner on public.community_comments
  as permissive for delete to authenticated
  using (public.owns_course_reference(course_slug));

-- Apagar a resposta aceita deixava a pergunta dizendo "Answered" sem resposta:
-- accepted_comment_id nao tem chave estrangeira (20260902160000:18). Definer
-- porque quem apaga (o autor do comentario, ou o dono do curso) pode nao ter
-- UPDATE no post pela RLS; o guard de campos (abaixo) aceita a troca porque
-- so accepted_comment_id muda. Quando o comentario cai em cascata junto com o
-- post, o UPDATE nao acha linha nenhuma: sem efeito.
create or replace function public.community_comments_clear_accepted_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.community_posts
     set accepted_comment_id = null
   where id = old.post_id
     and accepted_comment_id = old.id;
  return old;
end;
$function$;

-- So o trigger chama. Ninguem executa direto.
revoke all on function public.community_comments_clear_accepted_answer() from public, anon, authenticated;

drop trigger if exists community_comments_clear_accepted_answer on public.community_comments;
create trigger community_comments_clear_accepted_answer
  after delete on public.community_comments
  for each row execute function public.community_comments_clear_accepted_answer();

-- O dono do curso reescrevia o titulo da pergunta de um aluno: o guard
-- (20260906020000:226-235) listava as colunas PROIBIDAS e esqueceu title,
-- lesson_id e lesson_title (20260902160000). Agora e lista de PERMITIDAS: no
-- post de outra pessoa o dono muda so pinned, accepted_comment_id (o "Post
-- answer" da caixa do professor marca a resposta) e updated_at. author_role
-- vem do perfil (community_author_role_biu roda antes deste guard) e
-- course_slug segue a regra de sempre (so a forma canonica do mesmo curso).
-- Coluna nova nasce proibida para o dono. O ramo do autor fica como estava.
create or replace function public.community_posts_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_is_course_teacher boolean;
  v_owner_may_change constant text[] :=
    array['course_slug', 'author_role', 'pinned', 'accepted_comment_id', 'updated_at'];
begin
  if public.is_service_role() or public.is_admin() then
    return new;
  end if;
  v_is_course_teacher := public.owns_course_reference(old.course_slug);

  -- O dono que tambem e o autor cai no ramo do autor: edita e fixa o proprio post.
  if v_is_course_teacher and old.author_id is distinct from (select auth.uid())::text then
    if (new.course_slug is distinct from old.course_slug
        and new.course_slug is distinct from public.resolve_course_reference(old.course_slug))
       or (to_jsonb(new) - v_owner_may_change) is distinct from (to_jsonb(old) - v_owner_may_change) then
      raise exception 'community_posts: course-owning teacher may only change pinned/accepted_comment_id/updated_at';
    end if;
    return new;
  end if;
  if (new.course_slug is distinct from old.course_slug
      and new.course_slug is distinct from public.resolve_course_reference(old.course_slug))
     or new.author_id is distinct from old.author_id
     or new.author_name is distinct from old.author_name
     or new.created_at is distinct from old.created_at
     or (not v_is_course_teacher and coalesce(new.pinned, false) is distinct from coalesce(old.pinned, false)) then
    raise exception 'community_posts: author may only edit body/updated_at and may not self-pin';
  end if;
  return new;
end;
$function$;

revoke all on function public.community_posts_update_guard() from public, anon, authenticated;

-- A data do post e da resposta vinha do navegador (nowIso()): com
-- created_at = 2099 o post ficava no topo do mural, logo abaixo dos fixados,
-- e empurrava os novos para fora da janela de 200. Agora e a hora do servidor.
create or replace function public.community_stamp_created_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.community_stamp_created_at() from public, anon, authenticated;

drop trigger if exists community_posts_stamp_created_at on public.community_posts;
create trigger community_posts_stamp_created_at
  before insert on public.community_posts
  for each row execute function public.community_stamp_created_at();

drop trigger if exists community_comments_stamp_created_at on public.community_comments;
create trigger community_comments_stamp_created_at
  before insert on public.community_comments
  for each row execute function public.community_stamp_created_at();

-- Denuncia: o navegador mandava o autor denunciado, o nome de quem denuncia,
-- a resposta e a data, e ninguem conferia; a fila do /ops mostrava o que o
-- cliente quisesse. Agora o banco:
--   - pega o autor do post ou da resposta de verdade; a resposta tem de ser
--     daquele post, e denuncia de post nao leva comment_id;
--   - recusa denunciar o que a pessoa escreveu (o is_target_author da policy
--     compara o id da resposta com o id do post e nunca pega resposta);
--   - exige que quem denuncia enxergue o post: matriculado no curso ou dono
--     dele (o servidor, service_role, fica fora desta regra);
--   - pega nome e e-mail de quem denuncia do perfil, e a data do servidor;
--   - recusa uma segunda denuncia ABERTA da mesma pessoa no mesmo alvo
--     (COMMUNITY_REPORT_DUPLICATE; a tela diz "You already reported this").
-- course_slug ja chega canonico: community_00_course_reference_biu roda antes.
create or replace function public.community_reports_trusted_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_author_id text;
  v_author_name text;
begin
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
  if not public.is_service_role()
     and not (public.has_enrollment_for_course_slug(new.course_slug)
              or public.owns_course_reference(new.course_slug)) then
    raise exception 'community_reports: the reporter cannot see this post'
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

revoke all on function public.community_reports_trusted_fields() from public, anon, authenticated;

-- Nome depois de community_00_course_reference_biu e de
-- community_reports_insert_rate: roda por ultimo entre os BEFORE INSERT.
drop trigger if exists community_reports_trusted_fields on public.community_reports;
create trigger community_reports_trusted_fields
  before insert on public.community_reports
  for each row execute function public.community_reports_trusted_fields();

-- Post antigo com pinned nulo ia para depois de TODOS os nao fixados no mural
-- (order pinned desc nulls last) e podia cair fora da janela de 200. Escolha:
-- preencher com false e manter o default false, em vez de coalesce na
-- ordenacao (o PostgREST nao ordena por expressao). O UPDATE passa pelo guard:
-- nulo -> false nao conta como fixar.
update public.community_posts set pinned = false where pinned is null;
alter table public.community_posts alter column pinned set default false;

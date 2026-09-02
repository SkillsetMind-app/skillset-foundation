-- Comunidade simplificada (mockup 5, rodada 11): a pergunta e um post com
-- titulo, contexto de aula e UMA resposta aceita; o professor precisa LER a
-- propria comunidade sem estar matriculado.
--
-- O que a pessoa sofria:
--   * um post era so "categoria + corpo": a pergunta nao tinha titulo, ninguem
--     sabia de qual aula ela vinha, e "respondida" nao existia — o feed
--     mostrava tudo igual, sem ✓;
--   * o dono do curso so lia a comunidade se tivesse uma matricula (a policy
--     de leitura era "matriculado ou admin"); a de UPDATE ja o reconhecia.
--
-- Nada e apagado; colunas novas sao nulas; posts antigos seguem validos.

alter table public.community_posts
  add column if not exists title text,
  add column if not exists lesson_id text,
  add column if not exists lesson_title text,
  add column if not exists accepted_comment_id text;

comment on column public.community_posts.title is
  'A pergunta em uma linha (posts do tipo question). Nulo em compartilhamentos e avisos.';
comment on column public.community_posts.lesson_id is
  'Aula de onde a pergunta saiu ("from lesson 5"). Nulo quando feita fora de uma aula.';
comment on column public.community_posts.accepted_comment_id is
  'O comentario marcado como A resposta (pelo autor da pergunta ou pelo dono do curso). Nulo = em aberto.';

-- A resposta aceita tem que ser um comentario DESTE post. Sem isto, o autor
-- (que pode atualizar a propria linha) apontaria para qualquer id.
create or replace function public.community_posts_accepted_comment_belongs()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.accepted_comment_id is not null
     and not exists (
       select 1 from public.community_comments c
       where c.id = new.accepted_comment_id and c.post_id = new.id
     ) then
    raise exception 'accepted_comment_id must reference a comment of this post'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists community_posts_accepted_comment_belongs on public.community_posts;
create trigger community_posts_accepted_comment_belongs
  before insert or update of accepted_comment_id on public.community_posts
  for each row execute function public.community_posts_accepted_comment_belongs();

-- Leitura pelo dono do curso (posts, comentarios e reacoes). Mesmo criterio
-- da policy de UPDATE que ja existia: is_teacher() e courses.owner_id = uid,
-- casando course_slug com c.id OU c.slug (cursos publicados usam o id).
drop policy if exists community_posts_select_course_teacher on public.community_posts;
create policy community_posts_select_course_teacher
  on public.community_posts for select
  using (
    public.is_teacher() and exists (
      select 1 from public.courses c
      where (c.id = community_posts.course_slug or c.slug = community_posts.course_slug)
        and c.owner_id = (select auth.uid())::text
    )
  );

drop policy if exists community_comments_select_course_teacher on public.community_comments;
create policy community_comments_select_course_teacher
  on public.community_comments for select
  using (
    public.is_teacher() and exists (
      select 1 from public.courses c
      where (c.id = community_comments.course_slug or c.slug = community_comments.course_slug)
        and c.owner_id = (select auth.uid())::text
    )
  );

drop policy if exists community_post_likes_select_course_teacher on public.community_post_likes;
create policy community_post_likes_select_course_teacher
  on public.community_post_likes for select
  using (
    public.is_teacher() and exists (
      select 1
      from public.community_posts p
      join public.courses c
        on (c.id = p.course_slug or c.slug = p.course_slug)
      where p.id = community_post_likes.post_id
        and c.owner_id = (select auth.uid())::text
    )
  );

-- O dono do curso tambem RESPONDE (comentario) sem matricula: a policy de
-- insert exigia has_enrollment_for_course_slug. O autor da pergunta e o dono
-- podem marcar a resposta aceita: cobertos pelas policies de UPDATE existentes
-- (community_posts_update_author / community_posts_update_course_teacher).
drop policy if exists community_comments_insert_course_teacher on public.community_comments;
create policy community_comments_insert_course_teacher
  on public.community_comments for insert
  with check (
    author_id = (select auth.uid())::text
    and public.is_teacher()
    and exists (
      select 1 from public.courses c
      where (c.id = community_comments.course_slug or c.slug = community_comments.course_slug)
        and c.owner_id = (select auth.uid())::text
    )
  );

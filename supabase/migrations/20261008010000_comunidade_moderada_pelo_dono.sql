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
-- Nada e apagado por esta migration; ela so libera um caminho novo.

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
-- UPDATE no post pela RLS; o guard de campos (20260906020000:217-247) aceita
-- a troca porque so accepted_comment_id muda. Quando o comentario cai em
-- cascata junto com o post, o UPDATE nao acha linha nenhuma: sem efeito.
create or replace function public.community_comments_clear_accepted_answer()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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

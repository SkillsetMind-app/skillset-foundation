\set ON_ERROR_STOP on
-- Banco descartavel apenas. Fixtures voltam no ROLLBACK.
--
-- O dono do curso modera a propria comunidade
-- (20261008010000_comunidade_moderada_pelo_dono.sql):
--   - apaga post e comentario de aluno no curso dele, e as respostas vao junto;
--   - nao apaga nem desafixa nada na comunidade de OUTRO curso;
--   - fixa e desafixa, mas nao reescreve titulo, texto nem aula do aluno;
--   - aluno apaga so o que escreveu (post e comentario);
--   - a resposta aceita sai quando a resposta sai: apagada pelo autor, pelo
--     dono, em cascata com a resposta-mae ou com o post;
--   - a data do post e da resposta e a do servidor; a escrita confiavel
--     (restauracao so de dados) mantem a data que veio;
--   - a denuncia chega na fila do /ops com o autor, o nome e a data que o
--     banco conferiu; resposta de outro post, a propria resposta, quem nao e
--     do curso e a segunda denuncia aberta sao recusados;
--   - denuncia assinada com o id de outra pessoa para antes da checagem de
--     duplicata (senao ela dizia quem denunciou); quem nao e do curso recebe a
--     mesma recusa, com ou sem a resposta no post;
--   - pinned nulo mandado de proposito e recusado;
--   - as funcoes sao definer, com search_path fixo, e ninguem as chama direto.
-- Tudo pelo caminho real: cada um escreve sob RLS.
begin;
create temp table mod_checks (name text, passed boolean);
grant insert, select on mod_checks to authenticated;
create function pg_temp.check_mod(p_name text, p_ok boolean) returns void
language sql as $$ insert into mod_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61008010-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Linhas que o comando mudou. A RLS recusa UPDATE e DELETE em silencio (0 linhas).
create function pg_temp.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- O comando falha com este SQLSTATE. Se passar, e desfeito e conta como falha.
create function pg_temp.fails_with(p_sql text, p_state text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception when others then
  return sqlstate = p_state;
end $$;
-- 'SQLSTATE: mensagem' do erro. Se passar, e desfeito e devolve 'Z0001: no error'.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'no error' using errcode = 'Z0001';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- 1 dono do curso A · 2 aluna de A · 3 aluno de A · 4 dono do curso B
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'mod-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (4)) owners(n);
update public.users set display_name = 'Mod ' || right(uid, 1)
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 4) n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency, community_enabled)
values
  ('smoke-mod-a', pg_temp.uid(1)::text, 'smoke-mod-a-slug', 'Smoke mod A', 'smoke-mod-a',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true),
  ('smoke-mod-b', pg_temp.uid(4)::text, 'smoke-mod-b-slug', 'Smoke mod B', 'smoke-mod-b',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
select pg_temp.uid(n)::text || '__smoke-mod-a', pg_temp.uid(n)::text, 'smoke-mod-a', 'smoke-mod-a',
  'Smoke mod A', 'smoke', '', 'active', 'admin'
from generate_series(2, 3) n;
select set_config('skillset.trusted_write', 'off', true);

-- A aluna 2 pergunta e conversa; o navegador manda uma data de 2099.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, title, body,
  created_at, updated_at)
values
  ('smoke-mod-q', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'question', 'Where is the file?',
   'Synthetic question.', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z'),
  ('smoke-mod-d', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'discussion', null,
   'Synthetic discussion.', null, null);
reset role;
-- O aluno 3 responde tres vezes (a primeira tambem com data de 2099) e
-- responde a propria terceira resposta.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body, created_at)
values
  ('smoke-mod-c1', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic answer.',
   '2099-01-01T00:00:00Z'),
  ('smoke-mod-c2', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic reply.', null),
  ('smoke-mod-c3', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic second thought.', null);
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body, parent_id)
values ('smoke-mod-c4', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student',
  'Synthetic follow-up.', 'smoke-mod-c3');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a post dated in the future gets the server time',
  (select created_at = now() and updated_at = now() from public.community_posts where id = 'smoke-mod-q'));
select pg_temp.check_mod('a reply dated in the future gets the server time',
  (select created_at = now() from public.community_comments where id = 'smoke-mod-c1'));
-- Restauracao so de dados (skillset.trusted_write) mantem a data que veio.
select set_config('skillset.trusted_write', 'on', true);
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, body,
  created_at, updated_at)
values ('smoke-mod-r', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'discussion',
  'Synthetic restored post.', '2001-01-01T00:00:00Z', '2001-02-01T00:00:00Z');
select set_config('skillset.trusted_write', 'off', true);
select pg_temp.check_mod('a trusted restore keeps the post''s own dates',
  (select created_at = '2001-01-01T00:00:00Z' and updated_at = '2001-02-01T00:00:00Z'
     from public.community_posts where id = 'smoke-mod-r'));
-- O post de conversa nasce fixado (o banco nao deixa fixar no insert).
update public.community_posts set pinned = true where id = 'smoke-mod-d';

-- Dono de OUTRO curso nao apaga nem desafixa nada em A.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('another course owner cannot delete a post here',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
select pg_temp.check_mod('another course owner cannot delete a comment here',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c2'$q$) = 0);
select pg_temp.check_mod('another course owner cannot unpin here',
  pg_temp.affected($q$update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d'$q$) = 0);
reset role;

-- Aluno nao apaga nem desafixa o que e de outra pessoa.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s post',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s comment, even on her own post',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$) = 0);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member cannot unpin',
  (select pinned from public.community_posts where id = 'smoke-mod-d'));

-- O dono de A fixa, mas nao reescreve o que a aluna escreveu.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the course owner cannot rewrite a member''s title',
  pg_temp.fails_with($q$update public.community_posts set title = 'This course is a scam', updated_at = now()
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot rewrite a member''s text',
  pg_temp.fails_with($q$update public.community_posts set body = 'Rewritten by the owner.', updated_at = now()
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot move a member''s question to another lesson',
  pg_temp.fails_with($q$update public.community_posts set lesson_id = 'smoke-lesson', lesson_title = 'Smoke lesson'
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot rewrite a member''s reply',
  pg_temp.affected($q$update public.community_comments set body = 'Rewritten by the owner.'
    where id = 'smoke-mod-c2'$q$) = 0);
select pg_temp.check_mod('the course owner pins a member''s post',
  pg_temp.affected($q$update public.community_posts set pinned = true, updated_at = now()
    where id = 'smoke-mod-q'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the member''s words stay as she wrote them',
  (select title = 'Where is the file?' and body = 'Synthetic question.' and lesson_id is null and lesson_title is null
     and pinned
   from public.community_posts where id = 'smoke-mod-q')
  and (select body = 'Synthetic reply.' from public.community_comments where id = 'smoke-mod-c2'));

-- Denuncia: o aluno 3 manda autor, nome e data inventados; o banco troca.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_reports(course_slug, post_id, comment_id, target_type, target_author_id,
  target_author_name, reporter_id, reporter_name, reporter_email, reason, detail, status, created_at)
values ('smoke-mod-a', 'smoke-mod-d', null, 'post', pg_temp.uid(4)::text, 'Forged victim',
  pg_temp.uid(3)::text, 'Forged reporter', 'forged@example.test', 'spam', 'Synthetic report.', 'open',
  '2001-01-01T00:00:00Z');
select pg_temp.check_mod('a second open report of the same post is refused',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 3', 'other', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '23505'));
select pg_temp.check_mod('a reply report must name the reply''s own post',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', 'smoke-mod-c1', 'comment', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '42501'));
select pg_temp.check_mod('nobody reports their own reply',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '42501'));
reset role;
-- A aluna 2 denuncia uma resposta do aluno 3, dizendo que e do dono.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_reports(course_slug, post_id, comment_id, target_type, target_author_id,
  target_author_name, reporter_id, reporter_name, reason, status)
values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', pg_temp.uid(1)::text, 'Forged owner',
  pg_temp.uid(2)::text, 'Mod 2', 'harassment', 'open');
-- A autora de smoke-mod-d assina com o id do aluno 3, que tem denuncia aberta
-- ali. Se a duplicata fosse conferida antes, o 23505 diria que foi ele.
select pg_temp.check_mod('a report signed with someone else''s id stops before the duplicate check',
  pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text)) = '42501: community_reports: the reporter must be the caller');
select pg_temp.check_mod('the reported author does not read the report against her',
  not exists (select 1 from public.community_reports where post_id = 'smoke-mod-d'));
reset role;
-- Quem nao e do curso A nao denuncia nada la.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('someone outside the course cannot report there',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(4)::text), '42501'));
-- c1 nao e de smoke-mod-d; c2 e de smoke-mod-q. A recusa e a mesma.
select pg_temp.check_mod('an outsider gets the same refusal whether or not the reply is in the post',
  pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', 'smoke-mod-c1', 'comment', %L, 'Mod 3', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(3)::text, pg_temp.uid(4)::text)) = '42501: community_reports: the reporter cannot see this post'
  and pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', %L, 'Mod 3', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(3)::text, pg_temp.uid(4)::text)) = '42501: community_reports: the reporter cannot see this post');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a post report reaches the ops queue with the real author, reporter and time',
  exists (select 1 from public.community_reports
    where post_id = 'smoke-mod-d' and comment_id is null and reporter_id = pg_temp.uid(3)::text
      and course_slug = 'smoke-mod-a' and status = 'open' and reason = 'spam'
      and target_author_id = pg_temp.uid(2)::text and target_author_name = 'Mod 2'
      and reporter_name = 'Mod 3' and reporter_email = 'mod-smoke-3@example.test'
      and created_at = now()));
select pg_temp.check_mod('a reply report names the reply''s real author',
  exists (select 1 from public.community_reports
    where comment_id = 'smoke-mod-c2' and post_id = 'smoke-mod-q' and reporter_id = pg_temp.uid(2)::text
      and target_author_id = pg_temp.uid(3)::text and target_author_name = 'Mod 3'
      and reporter_name = 'Mod 2'));
select pg_temp.check_mod('only the two real reports were stored',
  (select count(*) = 2 from public.community_reports where course_slug = 'smoke-mod-a'));

-- A resposta aceita sai quando a resposta sai, por qualquer caminho.
-- 1) O aluno apaga a propria resposta aceita.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c1', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the author still deletes his own comment',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c1'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member deleting his own accepted answer clears it',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null);
-- 2) O dono apaga a resposta aceita.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c2', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the course owner deletes a member''s comment',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c2'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the owner deleting the accepted answer clears it',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null);
-- 3) A resposta aceita era resposta de outra resposta, e a mae foi apagada.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c4', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('an accepted reply that goes with its parent clears the mark',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null
  and not exists (select 1 from public.community_comments where id in ('smoke-mod-c3', 'smoke-mod-c4')));
-- 4) O post sai com a resposta aceita dentro.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-mod-c5', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic final answer.');
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c5', updated_at = now() where id = 'smoke-mod-q';
reset role;

-- O dono desafixa a conversa e apaga a pergunta (com a resposta aceita).
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
select pg_temp.check_mod('the course owner deletes a member''s post, accepted answer and all',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-q'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the course owner unpins',
  not (select pinned from public.community_posts where id = 'smoke-mod-d'));
select pg_temp.check_mod('the post''s replies went with it',
  not exists (select 1 from public.community_comments where post_id = 'smoke-mod-q'));

-- A autora continua apagando o que escreveu.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the author still deletes her own post',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 1);
reset role;

-- As funcoes: SECURITY DEFINER, search_path fixo, ninguem de fora executa.
select pg_temp.check_mod('functions: security definer with a fixed search_path',
  (select count(*) = 4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'])
     from pg_proc p
     where p.oid in ('public.community_comments_clear_accepted_answer()'::regprocedure,
                     'public.community_posts_update_guard()'::regprocedure,
                     'public.community_stamp_created_at()'::regprocedure,
                     'public.community_reports_trusted_fields()'::regprocedure)));
select pg_temp.check_mod('functions: anon and authenticated cannot call them',
  not exists (
    select 1
    from unnest(array['public.community_comments_clear_accepted_answer()',
                      'public.community_posts_update_guard()',
                      'public.community_stamp_created_at()',
                      'public.community_reports_trusted_fields()']) f,
         unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, f, 'execute')));
select pg_temp.check_mod('posts default to not pinned',
  (select pg_get_expr(d.adbin, d.adrelid) = 'false'
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.community_posts'::regclass and a.attname = 'pinned'));
-- A policy de insert usa coalesce(pinned, false): o not null e que recusa o nulo.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a post cannot be saved with pinned empty',
  pg_temp.fails_with(format($q$insert into public.community_posts(id, course_slug, author_id, author_name, author_role,
    category, body, pinned)
    values ('smoke-mod-n', 'smoke-mod-a', %L, 'Mod 2', 'student', 'discussion', 'Synthetic post.', null)$q$,
    pg_temp.uid(2)::text), '23502'));
reset role;

select pg_temp.check_mod('every case ran', (select count(*) = 38 from mod_checks));
select name, passed from mod_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from mod_checks where not passed;
  if failures is not null then
    raise exception 'COMMUNITY_MODERATION_REGRESSION: %', failures;
  end if;
end $$;
rollback;

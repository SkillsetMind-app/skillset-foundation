\set ON_ERROR_STOP on
-- Banco descartavel apenas. Fixtures voltam no ROLLBACK.
--
-- O dono do curso modera a propria comunidade
-- (20261008010000_comunidade_moderada_pelo_dono.sql):
--   - apaga post e comentario de aluno no curso dele, e as respostas vao junto;
--   - nao apaga nada na comunidade de OUTRO curso;
--   - aluno apaga so o que escreveu (post e comentario);
--   - apagar a resposta aceita limpa accepted_comment_id;
--   - desafixar: o dono pode, o aluno nao;
--   - a denuncia de um aluno chega na fila do /ops (community_reports).
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
-- Linhas que o comando apagou. A RLS recusa DELETE em silencio (0 linhas).
create function pg_temp.deleted(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- 1 dono do curso A · 2 aluna de A · 3 aluno de A · 4 dono do curso B
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'mod-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
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

-- A aluna 2 pergunta e conversa; o aluno 3 responde tres vezes.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, title, body)
values
  ('smoke-mod-q', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'question', 'Where is the file?', 'Synthetic question.'),
  ('smoke-mod-d', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'discussion', null, 'Synthetic discussion.');
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values
  ('smoke-mod-c1', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic answer.'),
  ('smoke-mod-c2', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic reply.'),
  ('smoke-mod-c3', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic second thought.');
reset role;
-- A autora marca a primeira resposta como A resposta.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c1', updated_at = now() where id = 'smoke-mod-q';
reset role;
-- O post de conversa nasce fixado (o banco nao deixa fixar no insert).
select pg_temp.act_as(null, 'service_role');
update public.community_posts set pinned = true where id = 'smoke-mod-d';

-- Dono de OUTRO curso nao apaga nada em A.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('another course owner cannot delete a post here',
  pg_temp.deleted($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
select pg_temp.check_mod('another course owner cannot delete a comment here',
  pg_temp.deleted($q$delete from public.community_comments where id = 'smoke-mod-c2'$q$) = 0);
reset role;

-- Aluno nao apaga nem desafixa o que e de outra pessoa.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s post',
  pg_temp.deleted($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s comment, even on her own post',
  pg_temp.deleted($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$) = 0);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member cannot unpin',
  (select pinned from public.community_posts where id = 'smoke-mod-d'));

-- O autor continua apagando o proprio comentario; e a denuncia dele vai para
-- a fila do /ops (o professor nao le community_reports; a equipe le).
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the author still deletes his own comment',
  pg_temp.deleted($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$) = 1);
insert into public.community_reports(course_slug, post_id, comment_id, target_type, target_author_id,
  target_author_name, reporter_id, reporter_name, reason, detail, status)
values ('smoke-mod-a', 'smoke-mod-d', null, 'post', pg_temp.uid(2)::text, 'Mod 2',
  pg_temp.uid(3)::text, 'Mod 3', 'spam', 'Synthetic report.', 'open');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member''s report reaches the ops queue',
  exists (select 1 from public.community_reports
    where post_id = 'smoke-mod-d' and reporter_id = pg_temp.uid(3)::text
      and course_slug = 'smoke-mod-a' and status = 'open' and reason = 'spam'));

-- O dono de A apaga a resposta aceita: a pergunta deixa de dizer "Answered".
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the course owner deletes a member''s comment',
  pg_temp.deleted($q$delete from public.community_comments where id = 'smoke-mod-c1'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('deleting the accepted answer clears it',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null);

-- O dono desafixa e apaga o post da aluna; as respostas vao junto.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
select pg_temp.check_mod('the course owner deletes a member''s post',
  pg_temp.deleted($q$delete from public.community_posts where id = 'smoke-mod-q'$q$) = 1);
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
  pg_temp.deleted($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 1);
reset role;

select pg_temp.check_mod('every case ran', (select count(*) = 13 from mod_checks));
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

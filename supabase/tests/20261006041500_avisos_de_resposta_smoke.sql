\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Quem responde, avisa (20261006041500_avisos_de_resposta.sql):
--   - pergunta nova avisa o dono do curso, uma vez; outro tipo de post não;
--   - resposta avisa o autor do post e quem já respondeu, uma vez cada;
--   - quem escreveu a resposta nunca recebe aviso dela;
--   - resposta do suporte avisa o dono do ticket; regravar o mesmo texto não;
--   - o texto não é frase em inglês: title vazio, ids em params;
--   - cada um lê só os próprios avisos; estranho e anon não leem nada;
--   - o cliente continua sem gravar params nem emailed_at.
-- Tudo pelo caminho real: aluno, professor e suporte escrevem sob RLS.
begin;
create temp table aviso_checks (name text, passed boolean);
grant insert, select on aviso_checks to anon, authenticated;
create function pg_temp.check_aviso(p_name text, p_ok boolean) returns void
language sql as $$ insert into aviso_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61006415-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Avisos que o trigger gravou para a pessoa n (opcionalmente de um tipo).
create function pg_temp.avisos(n int, p_type text default null) returns bigint language sql as $$
  select count(*) from public.notifications
  where user_id = pg_temp.uid(n)::text and (p_type is null or type = p_type);
$$;
-- Respostas (commentId) que geraram aviso para a pessoa n, em ordem.
create function pg_temp.comments_for(n int, p_type text) returns text[] language sql as $$
  select coalesce(array_agg(params->>'commentId' order by params->>'commentId'), '{}')
  from public.notifications
  where user_id = pg_temp.uid(n)::text and type = p_type;
$$;
-- Número de linhas que a consulta devolveu, ou -1 se ela foi recusada.
create function pg_temp.rows_or_denied(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;
-- true só quando a escrita falha com a mensagem esperada. Sucesso é desfeito.
create function pg_temp.refused(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm like p_like;
end $$;

-- 1 professor dono do curso · 2 aluna que pergunta · 3 e 4 alunos que
-- respondem · 5 conta de fora (sem matrícula) · 6 admin que responde o suporte
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'avisos-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 6) n;
update public.users set display_name = 'Avisos ' || right(uid, 1)
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 6) n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
update public.users set roles = '["student","admin"]' where uid = pg_temp.uid(6)::text;
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency, community_enabled)
values ('smoke-avisos', pg_temp.uid(1)::text, 'smoke-avisos-slug', 'Smoke avisos', 'smoke-avisos',
  'Curso usado só por este smoke de avisos.', 'smoke', 'published', 'free', 0, 'USD', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
select pg_temp.uid(n)::text || '__smoke-avisos', pg_temp.uid(n)::text, 'smoke-avisos', 'smoke-avisos',
  'Smoke avisos', 'smoke', '', 'active', 'admin'
from generate_series(2, 4) n;
insert into public.support_tickets(id, user_id, category, subject, message)
values ('smoke-avisos-ticket', pg_temp.uid(2)::text, 'account', 'Cannot change my email', 'Synthetic support message.');
select set_config('skillset.trusted_write', 'off', true);

-- 1. Pergunta nova: avisa o dono do curso, e só ele.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, title, body)
values ('smoke-avisos-q', 'smoke-avisos', pg_temp.uid(2)::text, 'Avisos 2', 'student', 'question',
  'How do I export the worksheet?', 'Synthetic question body.');
reset role;
select pg_temp.check_aviso('question: the course owner gets exactly one notification',
  pg_temp.avisos(1) = 1 and pg_temp.avisos(1, 'community_question') = 1);
select pg_temp.check_aviso('question: the owner link opens the studio community inbox',
  exists (select 1 from public.notifications
    where user_id = pg_temp.uid(1)::text and type = 'community_question'
      and link = '/teach/courses/smoke-avisos/community'
      and params->>'postId' = 'smoke-avisos-q' and params->>'courseId' = 'smoke-avisos'
      and body = 'How do I export the worksheet?' and actor_name = 'Avisos 2'));
select pg_temp.check_aviso('question: the author gets no notification for asking', pg_temp.avisos(2) = 0);

-- Discussão (não é pergunta): ninguém é avisado.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, body)
values ('smoke-avisos-discussion', 'smoke-avisos', pg_temp.uid(3)::text, 'Avisos 3', 'student', 'discussion',
  'Synthetic discussion body.');
reset role;
select pg_temp.check_aviso('discussion: a post that is not a question notifies nobody',
  pg_temp.avisos(1) = 1 and pg_temp.avisos(3) = 0);

-- 2. Respostas, cada uma escrita por quem diz o author_id:
--   c1 por 3, c2 pelo professor, c3 por 3 de novo, c4 pela autora, c5 por 4.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c1', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(3)::text, 'Avisos 3', 'student',
  'Use the export button.');
reset role;
select pg_temp.check_aviso('reply: the question author gets one notification for the first reply',
  pg_temp.comments_for(2, 'community_comment') = array['smoke-avisos-c1']);
select pg_temp.check_aviso('reply: the student link opens the question in the classroom',
  exists (select 1 from public.notifications
    where user_id = pg_temp.uid(2)::text and params->>'commentId' = 'smoke-avisos-c1'
      and link = '/learn/courses/smoke-avisos/community/q/smoke-avisos-q'
      and params->>'postId' = 'smoke-avisos-q' and params->>'category' = 'question'
      and body = 'Use the export button.' and actor_name = 'Avisos 3'));
select pg_temp.check_aviso('reply: the owner is not told about a thread they are not in',
  pg_temp.avisos(1) = 1);

select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c2', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(1)::text, 'Avisos 1', 'teacher',
  'Teacher answer here.');
reset role;

select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c3', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(3)::text, 'Avisos 3', 'student',
  'Thanks, it worked.');
reset role;

select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c4', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(2)::text, 'Avisos 2', 'student',
  'Solved, thank you all.');
reset role;

select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c5', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(4)::text, 'Avisos 4', 'student',
  'Late to the thread.');
reset role;

select pg_temp.check_aviso('reply: the post author gets community_comment for every reply but her own',
  pg_temp.comments_for(2, 'community_comment')
    = array['smoke-avisos-c1', 'smoke-avisos-c2', 'smoke-avisos-c3', 'smoke-avisos-c5']
  and pg_temp.avisos(2) = 4);
select pg_temp.check_aviso('reply: the author who also replied gets one notification, not a second community_reply',
  pg_temp.avisos(2, 'community_reply') = 0);
select pg_temp.check_aviso('reply: an earlier replier gets community_reply for later replies by others',
  pg_temp.comments_for(3, 'community_reply') = array['smoke-avisos-c2', 'smoke-avisos-c4', 'smoke-avisos-c5']
  and pg_temp.avisos(3) = 3);
select pg_temp.check_aviso('reply: the owner who replied gets community_reply with the studio link',
  pg_temp.comments_for(1, 'community_reply') = array['smoke-avisos-c3', 'smoke-avisos-c4', 'smoke-avisos-c5']
  and not exists (select 1 from public.notifications
    where user_id = pg_temp.uid(1)::text and link <> '/teach/courses/smoke-avisos/community'));
select pg_temp.check_aviso('reply: a newcomer to the thread gets nothing for the own reply', pg_temp.avisos(4) = 0);
select pg_temp.check_aviso('reply: nobody is ever notified of the own reply',
  not exists (select 1 from public.notifications n
    join public.community_comments c on c.id = n.params->>'commentId'
    where n.user_id = c.author_id));
select pg_temp.check_aviso('reply: nobody gets two notifications for the same reply',
  not exists (select 1 from public.notifications
    where params ? 'commentId'
    group by user_id, params->>'commentId' having count(*) > 1));

-- 3. Suporte: a resposta avisa o dono do ticket.
select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
update public.support_tickets
  set admin_response = 'Changed it for you.', responded_by = pg_temp.uid(6)::text,
      responded_at = now(), status = 'resolved', updated_at = now()
  where id = 'smoke-avisos-ticket';
-- Regravar o mesmo texto não é resposta nova.
update public.support_tickets
  set admin_response = 'Changed it for you.', updated_at = now()
  where id = 'smoke-avisos-ticket';
reset role;
select pg_temp.check_aviso('support: the ticket owner gets exactly one notification',
  pg_temp.avisos(2, 'support_reply') = 1);
select pg_temp.check_aviso('support: the notification points to the ticket',
  exists (select 1 from public.notifications
    where user_id = pg_temp.uid(2)::text and type = 'support_reply'
      and link = '/support' and params->>'ticketId' = 'smoke-avisos-ticket'
      and body = 'Cannot change my email'));
select pg_temp.check_aviso('support: whoever answered gets nothing', pg_temp.avisos(6) = 0);

select pg_temp.check_aviso('text: the new notifications store no English sentence',
  not exists (select 1 from public.notifications
    where user_id in (select pg_temp.uid(n)::text from generate_series(1, 6) n) and title <> ''));
select pg_temp.check_aviso('email: new notifications start never emailed',
  not exists (select 1 from public.notifications
    where user_id in (select pg_temp.uid(n)::text from generate_series(1, 6) n) and emailed_at is not null));

-- 4. RLS: cada um lê só os próprios avisos.
select pg_temp.act_as(pg_temp.uid(5), 'authenticated');
set local role authenticated;
select pg_temp.check_aviso('rls: a stranger reads none of these notifications',
  pg_temp.rows_or_denied('select 1 from public.notifications') = 0);
reset role;

select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_aviso('rls: a recipient reads only the own notifications',
  pg_temp.rows_or_denied('select 1 from public.notifications') = 3
  and pg_temp.rows_or_denied(format(
    'select 1 from public.notifications where user_id <> %L', pg_temp.uid(3)::text)) = 0);
reset role;

select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_aviso('rls: anon reads no notification',
  pg_temp.rows_or_denied('select 1 from public.notifications') in (0, -1));
reset role;

-- 5. O cliente marca como lido e mais nada.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_aviso('guard: the owner cannot mark a notification as emailed',
  pg_temp.refused(format(
    'update public.notifications set emailed_at = now() where user_id = %L', pg_temp.uid(2)::text),
    'notifications: clients may only modify the read flag'));
select pg_temp.check_aviso('guard: the owner cannot rewrite params',
  pg_temp.refused(format(
    $q$update public.notifications set params = '{"postId":"other"}' where user_id = %L$q$, pg_temp.uid(2)::text),
    'notifications: clients may only modify the read flag'));
select pg_temp.check_aviso('rls: the owner reads all five of the own notifications',
  pg_temp.rows_or_denied(format(
    'select 1 from public.notifications where user_id = %L', pg_temp.uid(2)::text)) = 5);
update public.notifications set read = true where user_id = pg_temp.uid(2)::text;
reset role;
select pg_temp.check_aviso('guard: the owner can still mark notifications as read',
  not exists (select 1 from public.notifications where user_id = pg_temp.uid(2)::text and not read));

-- 6. As funções: SECURITY DEFINER, search_path fixo, ninguém de fora executa.
select pg_temp.check_aviso('functions: security definer with a fixed search_path',
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'])
     from pg_proc p
     where p.oid in ('public.notify_course_owner_on_question()'::regprocedure,
                     'public.notify_on_community_comment()'::regprocedure,
                     'public.notify_ticket_owner_on_support_reply()'::regprocedure)));
select pg_temp.check_aviso('functions: anon and authenticated cannot call them',
  not exists (
    select 1
    from unnest(array['public.notify_course_owner_on_question()',
                      'public.notify_on_community_comment()',
                      'public.notify_ticket_owner_on_support_reply()']) f,
         unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, f, 'execute')));

select name, passed from aviso_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from aviso_checks where not passed;
  if failures is not null then
    raise exception 'REPLY_NOTICE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

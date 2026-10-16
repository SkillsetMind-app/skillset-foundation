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
--   - o cliente continua sem gravar params nem emailed_at;
--   - quem perdeu a matrícula não recebe mais respostas daquele curso;
--   - o nome no aviso vem do perfil, nunca do author_name do cliente;
--   - editar atualiza o trecho sem avisar de novo; apagar apaga o aviso;
--   - o resumo por e-mail (claim_notification_digests) pula quem desligou,
--     está suspenso, não confirmou, foi apagado ou recebeu nesta hora, sem
--     segurar a fila, e nunca devolve o mesmo aviso duas vezes.
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
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1)) owners(n);
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
                     'public.notify_ticket_owner_on_support_reply()'::regprocedure,
                     'public.sync_notifications_with_community_content()'::regprocedure,
                     'public.set_community_author_role()'::regprocedure,
                     'public.claim_notification_digests(integer)'::regprocedure)));
select pg_temp.check_aviso('functions: anon and authenticated cannot call them',
  not exists (
    select 1
    from unnest(array['public.notify_course_owner_on_question()',
                      'public.notify_on_community_comment()',
                      'public.notify_ticket_owner_on_support_reply()',
                      'public.sync_notifications_with_community_content()',
                      'public.set_community_author_role()',
                      'public.claim_notification_digests(integer)']) f,
         unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, f, 'execute')));
select pg_temp.check_aviso('functions: the service role can claim digests',
  has_function_privilege('service_role', 'public.claim_notification_digests(integer)', 'execute'));

-- 7. Quem perdeu o acesso não recebe mais; o nome vem do perfil, não do cliente.
-- A matrícula do aluno 3 é revogada e o aluno 4 responde dizendo ser o suporte.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.enrollments set status = 'revoked' where id = pg_temp.uid(3)::text || '__smoke-avisos';
select set_config('skillset.trusted_write', 'off', true);

select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c6', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(4)::text, 'SkillsetMind Support', 'student',
  'Your account will be closed.');
reset role;
select pg_temp.check_aviso('access: a replier whose enrollment was revoked gets nothing for later replies',
  pg_temp.comments_for(3, 'community_reply') = array['smoke-avisos-c2', 'smoke-avisos-c4', 'smoke-avisos-c5']
  and not exists (select 1 from public.notifications
    where user_id = pg_temp.uid(3)::text and params->>'commentId' = 'smoke-avisos-c6'));
select pg_temp.check_aviso('access: the post author and the course owner still get the reply',
  (select array_agg(user_id || ':' || type order by user_id) from public.notifications
    where params->>'commentId' = 'smoke-avisos-c6')
    = array[pg_temp.uid(1)::text || ':community_reply', pg_temp.uid(2)::text || ':community_comment']);
select pg_temp.check_aviso('name: the notification shows the profile name, never the name the client sent',
  (select bool_and(actor_name = 'Avisos 4') from public.notifications
    where params->>'commentId' = 'smoke-avisos-c6'));
select pg_temp.check_aviso('name: the reply itself stores the profile name',
  (select author_name = 'Avisos 4' from public.community_comments where id = 'smoke-avisos-c6'));

-- Sem nome no perfil: "SkillsetMind member", nunca o e-mail nem o que veio do cliente.
select pg_temp.act_as(null, 'service_role');
update public.users set display_name = null where uid = pg_temp.uid(4)::text;
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-avisos-c7', 'smoke-avisos-q', 'smoke-avisos', pg_temp.uid(4)::text, 'avisos-smoke-4@example.test',
  'student', 'One more thing.');
reset role;
select pg_temp.check_aviso('name: an empty profile name falls back to SkillsetMind member',
  (select bool_and(actor_name = 'SkillsetMind member') from public.notifications
    where params->>'commentId' = 'smoke-avisos-c7')
  and (select author_name = 'SkillsetMind member' from public.community_comments where id = 'smoke-avisos-c7'));

-- 8. Editar atualiza o trecho guardado, sem avisar de novo; apagar apaga o aviso.
create temp table aviso_antes as
  select notification_id, read, emailed_at from public.notifications
  where user_id in (select pg_temp.uid(n)::text from generate_series(1, 6) n);

select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_comments set body = 'Solved.', updated_at = now() where id = 'smoke-avisos-c4';
update public.community_posts set title = 'How do I export it?', updated_at = now() where id = 'smoke-avisos-q';
reset role;
select pg_temp.check_aviso('edit: the reply notifications carry the edited text',
  (select count(*) = 2 and bool_and(body = 'Solved.') from public.notifications
    where params->>'commentId' = 'smoke-avisos-c4'));
select pg_temp.check_aviso('edit: the question notification carries the edited title',
  exists (select 1 from public.notifications
    where user_id = pg_temp.uid(1)::text and type = 'community_question' and body = 'How do I export it?'));
select pg_temp.check_aviso('edit: an edit creates no notification and keeps read and emailed_at',
  (select count(*) from public.notifications
    where user_id in (select pg_temp.uid(n)::text from generate_series(1, 6) n))
    = (select count(*) from aviso_antes)
  and not exists (select 1 from aviso_antes a join public.notifications n using (notification_id)
    where n.read is distinct from a.read or n.emailed_at is distinct from a.emailed_at));

-- O admin modera uma resposta; depois a autora apaga a pergunta inteira.
select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
delete from public.community_comments where id = 'smoke-avisos-c5';
reset role;
select pg_temp.check_aviso('delete: a moderated reply leaves no notification behind',
  not exists (select 1 from public.notifications where params->>'commentId' = 'smoke-avisos-c5')
  and exists (select 1 from public.notifications where params->>'commentId' = 'smoke-avisos-c4'));

select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
delete from public.community_posts where id = 'smoke-avisos-q';
reset role;
select pg_temp.check_aviso('delete: a deleted question takes all of its notifications with it',
  not exists (select 1 from public.community_posts where id = 'smoke-avisos-q')
  and not exists (select 1 from public.notifications where params->>'postId' = 'smoke-avisos-q'));
select pg_temp.check_aviso('delete: notifications of other things stay',
  pg_temp.avisos(2, 'support_reply') = 1);

-- 9. O resumo por e-mail: claim_notification_digests escolhe e marca.
-- Na fila só ficam os avisos deste smoke (o resto volta no ROLLBACK).
--  7 recebe · 8 desligou o resumo · 9 suspenso · 10 e-mail não confirmado
--  11 recebeu um resumo há 30 minutos · 12 nada na fila · 13 conta apagada
--  14 e 15 recebem
--  100-159 desligaram e 160-219 estão suspensos, todos com aviso mais antigo
--  que o de 7: 120 pessoas que não podem receber na frente da fila.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
delete from public.notifications where user_id not like '61006415-%';
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'avisos-smoke-' || n || '@example.test',
  case when n = 10 then null else now() end, '{}',
  case when n = 7 then '{"locale":"es"}' else '{}' end::jsonb, now(), now()
from (select generate_series(7, 15) union all select generate_series(100, 219)) s(n);
update auth.users set deleted_at = now() where id = pg_temp.uid(13);
update public.users set preferences = '{"notifications":{"emailDigest":false}}'
  where uid in (select pg_temp.uid(n)::text from generate_series(100, 159) n) or uid = pg_temp.uid(8)::text;
insert into public.account_controls(uid, suspended, sessions_revoked_before)
select pg_temp.uid(n)::text, true, now()
from (select 9 union all select generate_series(160, 219)) s(n);

create function pg_temp.fila(p_id text, n int, p_age interval, p_read boolean default false,
  p_emailed_ago interval default null) returns void language sql as $$
  insert into public.notifications(notification_id, user_id, type, title, body, read, link, created_at, emailed_at)
  values (p_id, pg_temp.uid(n)::text, 'community_reply', '', 'Synthetic digest row.', p_read,
    '/account/notifications', now() - p_age, now() - p_emailed_ago);
$$;
select pg_temp.fila('d7a', 7, '40 minutes');
select pg_temp.fila('d7b', 7, '20 minutes');
select pg_temp.fila('d7-young', 7, '5 minutes');
select pg_temp.fila('d7-old', 7, '4 days');
select pg_temp.fila('d7-read', 7, '30 minutes', true);
select pg_temp.fila('d' || n, n, '2 days') from (values (8), (9), (10), (11), (13)) v(n);
select pg_temp.fila('d11-sent', 11, '2 hours', false, '30 minutes');
select pg_temp.fila('d14', 14, '30 minutes');
select pg_temp.fila('d15', 15, '25 minutes');
select pg_temp.fila('d' || n, n, '2 days 1 hour') from generate_series(100, 219) n;
select set_config('skillset.trusted_write', 'off', true);

create temp table aviso_claims (
  round int, user_id text, email text, locale text, notification_ids text[], notification_count int);
grant insert, select on aviso_claims to service_role;
set local role service_role;
insert into aviso_claims select 1, * from public.claim_notification_digests(1);
insert into aviso_claims select 2, * from public.claim_notification_digests(1);
insert into aviso_claims select 3, * from public.claim_notification_digests(1);
insert into aviso_claims select 4, * from public.claim_notification_digests(100);
reset role;

select pg_temp.check_aviso('digest: 120 people who cannot get email at the head of the queue do not block the next one',
  (select array_agg(user_id) from aviso_claims where round = 1) = array[pg_temp.uid(7)::text]);
select pg_temp.check_aviso('digest: only unread, never emailed rows from 10 minutes to 3 days old go in',
  exists (select 1 from aviso_claims where round = 1
    and notification_ids = array['d7a', 'd7b'] and notification_count = 2));
select pg_temp.check_aviso('digest: the claim marks exactly the rows it returns',
  (select bool_and(emailed_at is not null) from public.notifications where notification_id in ('d7a', 'd7b'))
  and (select bool_and(emailed_at is null) from public.notifications
    where notification_id in ('d7-young', 'd7-old', 'd7-read')));
select pg_temp.check_aviso('digest: it returns the address and the language of the account',
  exists (select 1 from aviso_claims where round = 1
    and email = 'avisos-smoke-7@example.test' and locale = 'es'));
select pg_temp.check_aviso('digest: oldest waiting person first, one person per claim',
  (select array_agg(user_id order by round) from aviso_claims where round in (2, 3))
    = array[pg_temp.uid(14)::text, pg_temp.uid(15)::text]);
select pg_temp.check_aviso('digest: two claims never return the same notification or person',
  not exists (select 1 from aviso_claims, unnest(notification_ids) id group by id having count(*) > 1)
  and not exists (select 1 from aviso_claims group by user_id having count(*) > 1));
select pg_temp.check_aviso('digest: opted out, suspended, unconfirmed, deleted or emailed this hour: never claimed',
  not exists (select 1 from aviso_claims
    where user_id in (select pg_temp.uid(n)::text from generate_series(8, 13) n)
       or user_id in (select pg_temp.uid(n)::text from generate_series(100, 219) n))
  and not exists (select 1 from aviso_claims where round = 4)
  and (select bool_and(emailed_at is null) from public.notifications
    where notification_id in ('d8', 'd9', 'd10', 'd11', 'd13')));
-- Concorrência: uma execução que já segura as linhas é pulada, e a outra só
-- marca o que ainda está sem emailed_at no mesmo comando que devolve.
select pg_temp.check_aviso('digest: concurrent runs skip rows another run holds',
  (select prosrc ~* 'for update of n skip locked' and prosrc ~* 'update public[.]notifications n'
     from pg_proc where oid = 'public.claim_notification_digests(integer)'::regprocedure));

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

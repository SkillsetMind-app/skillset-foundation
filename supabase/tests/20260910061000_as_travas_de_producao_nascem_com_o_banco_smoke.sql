\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures e reversões voltam no ROLLBACK.
--
-- As 14 travas de 20260910061000 existem, estão ligadas às funções certas e
-- barram de verdade. A maior parte dos testes roda como o dono das tabelas
-- (sem RLS e sem grant no caminho) com o JWT de um cliente comum: o único
-- obstáculo que sobra é o trigger. Um teste repete o ataque real da auditoria
-- pelo RLS: o aluno muda o status da própria matrícula.
--
-- Reversão (scripts/build-test-db.sh): -v without_production_guards=1 derruba
-- as 13 travas de tabelas public dentro desta transação e exige RED exato.
begin;
\if :{?without_production_guards}
\ir fixtures/20260910061000_sem_as_travas.sql
\endif

create temp table guard_checks (name text, passed boolean);
grant insert, select on guard_checks to authenticated;
create function pg_temp.check_guard(p_name text, p_ok boolean) returns void
language sql as $$ insert into guard_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal1')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true só quando ESTA trava recusou, com a mensagem dela. Sucesso ou qualquer
-- outro erro contam como falha; a escrita que passou é desfeita.
create function pg_temp.refused(p_sql text, p_message text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm = p_message;
end $$;
-- Controle positivo: a trava não barra o que continua permitido.
create function pg_temp.accepted(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return true;
  when others then return false;
end $$;

-- Fixtures pelo servidor, como o app faz: service_role e escrita confiável.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'production-guard-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 2) n;
select pg_temp.check_guard('signup creates the profile row',
  (select count(*) = 2 from public.users
    where uid in (pg_temp.uid(1)::text, pg_temp.uid(2)::text) and roles = '["student"]'::jsonb));
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type, price_amount_minor, currency)
values ('production-guard-course', pg_temp.uid(1)::text, 'production-guard-course', 'Production guard fixture',
  'production-guard-course', 'Synthetic course for the production guard smoke.', 'smoke', 'draft', 'one_time', 100, 'USD');
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
values ('production-guard-enrollment', pg_temp.uid(2)::text, 'production-guard-course', 'production-guard-course',
  'Production guard fixture', 'smoke', '', 'active', 'admin');
insert into public.notifications(notification_id, user_id, type, title, body)
values ('production-guard-notification', pg_temp.uid(2)::text, 'system', 'Synthetic title', 'Synthetic body');
insert into public.support_tickets(id, user_id, category, subject, message)
values ('production-guard-ticket', pg_temp.uid(2)::text, 'account', 'Synthetic subject', 'Synthetic support message.');

-- Aluno comum.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
select pg_temp.check_guard('client cannot insert payments',
  pg_temp.refused('insert into public.payments default values',
    'table public.payments is server-write only'));
select pg_temp.check_guard('client cannot insert payout ledger rows',
  pg_temp.refused('insert into public.payout_ledger default values',
    'table public.payout_ledger is server-write only'));
select pg_temp.check_guard('student cannot rewrite a notification',
  pg_temp.refused($q$update public.notifications set title = 'Forged title' where notification_id = 'production-guard-notification'$q$,
    'notifications: clients may only modify the read flag'));
select pg_temp.check_guard('student can still mark a notification as read',
  pg_temp.accepted($q$update public.notifications set read = true where notification_id = 'production-guard-notification'$q$));
select pg_temp.check_guard('student cannot rewrite a support ticket',
  pg_temp.refused($q$update public.support_tickets set subject = 'Forged subject' where id = 'production-guard-ticket'$q$,
    'support_tickets: only status/admin_response/responded_by/responded_at may change'));
-- O ataque da auditoria, pelo caminho real: RLS deixa o dono atualizar a
-- própria matrícula em qualquer coluna; só o trigger segura status/course_id.
set local role authenticated;
select pg_temp.check_guard('student cannot change the status of the own enrollment through RLS',
  pg_temp.refused($q$update public.enrollments set status = 'completed' where id = 'production-guard-enrollment'$q$,
    'enrollments: owners may only update last_lesson_id and updated_at'));
select pg_temp.check_guard('student can still record the last lesson',
  pg_temp.accepted($q$update public.enrollments set last_lesson_id = 'production-guard-lesson' where id = 'production-guard-enrollment'$q$));
reset role;

-- Dono do curso: não publica escrevendo status; edita o que é dele.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
select pg_temp.check_guard('owner cannot publish by writing status',
  pg_temp.refused($q$update public.courses set status = 'published' where id = 'production-guard-course'$q$,
    'courses: status/featured/featured_rank/rating/trending/enrollment/platform_fee_bps are privileged (admin/ops/service only)'));
select pg_temp.check_guard('owner can still edit the title',
  pg_temp.accepted($q$update public.courses set title = 'Renamed production guard fixture' where id = 'production-guard-course'$q$));

-- Catálogo: as 14, habilitadas, com a função e o momento de produção.
select pg_temp.check_guard('all fourteen production guards are installed and bound', (
  select count(*) = 14
  from (values
    ('public.community_comments', 'community_comments_update_guard', 'public.community_comments_update_guard()', 19),
    ('public.community_posts', 'community_posts_update_guard', 'public.community_posts_update_guard()', 19),
    ('public.community_reports', 'community_reports_update_guard', 'public.community_reports_update_guard()', 19),
    ('public.course_event_rsvps', 'course_event_rsvps_update_guard', 'public.course_event_rsvps_update_guard()', 19),
    ('public.course_events', 'course_event_notify_enrolled', 'public.notify_enrolled_on_course_event()', 5),
    ('public.course_events', 'course_events_teacher_update_guard_trg', 'public.course_events_teacher_update_guard()', 19),
    ('public.courses', 'courses_freeze_privileged_columns_trg', 'public.courses_freeze_privileged_columns()', 19),
    ('public.enrollments', 'enrollments_owner_update_guard', 'public.enrollments_owner_update_guard()', 19),
    ('public.lesson_comments', 'lesson_comments_update_guard', 'public.lesson_comments_update_guard()', 19),
    ('public.notifications', 'trg_notifications_client_read_only', 'public.notifications_client_read_only_guard()', 19),
    ('public.payments', 'payments_server_write_only', 'public.server_write_only()', 31),
    ('public.payout_ledger', 'payout_ledger_server_write_only', 'public.server_write_only()', 31),
    ('public.support_tickets', 'support_tickets_update_guard', 'public.support_tickets_update_guard()', 19),
    ('auth.users', 'on_auth_user_created', 'public.handle_new_user()', 5)
  ) as v(tabela, nome, funcao, tipo)
  join pg_trigger t on t.tgrelid = v.tabela::regclass and t.tgname = v.nome
  where not t.tgisinternal and t.tgenabled <> 'D'
    and t.tgfoid = v.funcao::regprocedure and t.tgtype = v.tipo));

select name, passed from guard_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from guard_checks where not passed;
  if failures is not null then
    raise exception 'PRODUCTION_GUARD_REGRESSION: %', failures;
  end if;
end $$;
rollback;

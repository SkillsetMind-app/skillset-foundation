\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- P2-9: posts, comentários, denúncias e tickets entram direto pelo PostgREST.
-- Cada pessoa tem um teto por hora em cada tabela: a gravação seguinte ao teto
-- é recusada com RATE_LIMIT, outra pessoa continua gravando, e o servidor e a
-- escrita confiável do banco não têm teto.
begin;
create temp table write_rate_checks (name text, passed boolean);
grant insert, select on write_rate_checks to authenticated, service_role;
create function pg_temp.check_rate(p_name text, p_ok boolean) returns void
language sql as $$ insert into write_rate_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal1')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

-- 1 dono do curso; 2 e 3 alunos matriculados.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'write-rate-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 3) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now()
  where uid = pg_temp.uid(1)::text;
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
  payment_type, price_amount_minor, currency, community_enabled)
values ('write-rate-course', pg_temp.uid(1)::text, 'write-rate-course-slug', 'Write rate course',
  'write-rate-course', 'Course for isolated write rate tests.', 'smoke', 'published', 'free', 0, 'USD', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source)
select pg_temp.uid(n)::text || '__write-rate-course', pg_temp.uid(n)::text, 'write-rate-course',
  'write-rate-course', 'Write rate course', 'smoke', '', 'active', 'admin'
from generate_series(2, 3) n;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, body)
values ('write-rate-post', 'write-rate-course', pg_temp.uid(1)::text, 'Rate owner', 'teacher',
  'question', 'Target for replies and reports.');

-- Um INSERT por tabela, do jeito que o navegador grava; p_n só muda o texto.
create function pg_temp.write_post(p_author uuid, p_n int) returns void language sql as $$
  insert into public.community_posts(course_slug, author_id, author_name, author_role, category, body)
  values ('write-rate-course', p_author::text, 'Rate member', 'student', 'discussion',
    'Synthetic post ' || p_n || '.');
$$;
create function pg_temp.write_comment(p_author uuid, p_n int) returns void language sql as $$
  insert into public.community_comments(post_id, course_slug, author_id, author_name, author_role, body)
  values ('write-rate-post', 'write-rate-course', p_author::text, 'Rate member', 'student',
    'Synthetic reply ' || p_n || '.');
$$;
create function pg_temp.write_lesson_comment(p_author uuid, p_n int) returns void language sql as $$
  insert into public.lesson_comments(course_id, lesson_id, author_id, author_name, body)
  values ('write-rate-course', 'write-rate-lesson', p_author::text, 'Rate member',
    'Synthetic lesson comment ' || p_n || '.');
$$;
create function pg_temp.write_report(p_author uuid, p_n int) returns void language sql as $$
  insert into public.community_reports(course_slug, post_id, target_type, target_author_id,
    target_author_name, reporter_id, reporter_name, reason, detail, status)
  values ('write-rate-course', 'write-rate-post', 'post', pg_temp.uid(1)::text, 'Rate owner',
    p_author::text, 'Rate member', 'spam', 'Synthetic report ' || p_n || '.', 'open');
$$;
create function pg_temp.write_ticket(p_author uuid, p_n int) returns void language sql as $$
  insert into public.support_tickets(user_id, category, subject, message)
  values (p_author::text, 'technical', 'Ticket ' || p_n, 'Synthetic support request ' || p_n || '.');
$$;
-- Quantas de p_times gravações passaram antes da primeira recusa por
-- RATE_LIMIT. Outro erro derruba o teste: é fixture quebrada, não teto.
create function pg_temp.writes_before_limit(p_write text, p_author uuid, p_times int) returns int
language plpgsql as $$
declare v_done int := 0;
begin
  for i in 1..p_times loop
    begin
      execute format('select pg_temp.%I($1, $2)', p_write) using p_author, i;
    exception when others then
      if sqlerrm = 'RATE_LIMIT' then
        return v_done;
      end if;
      raise;
    end;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

-- Aluno 2 grava até o teto de cada tabela; a gravação seguinte é recusada.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_rate('learner: 21st post in the hour is refused',
  pg_temp.writes_before_limit('write_post', pg_temp.uid(2), 21) = 20);
select pg_temp.check_rate('learner: 121st community reply in the hour is refused',
  pg_temp.writes_before_limit('write_comment', pg_temp.uid(2), 121) = 120);
select pg_temp.check_rate('learner: 121st lesson comment in the hour is refused',
  pg_temp.writes_before_limit('write_lesson_comment', pg_temp.uid(2), 121) = 120);
select pg_temp.check_rate('learner: 21st report in the hour is refused',
  pg_temp.writes_before_limit('write_report', pg_temp.uid(2), 21) = 20);
select pg_temp.check_rate('learner: 11th support ticket in the hour is refused',
  pg_temp.writes_before_limit('write_ticket', pg_temp.uid(2), 11) = 10);
reset role;

-- Aluno 3 não herda o teto do aluno 2.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_rate('another learner still posts',
  pg_temp.writes_before_limit('write_post', pg_temp.uid(3), 1) = 1);
select pg_temp.check_rate('another learner still replies',
  pg_temp.writes_before_limit('write_comment', pg_temp.uid(3), 1) = 1);
select pg_temp.check_rate('another learner still comments on the lesson',
  pg_temp.writes_before_limit('write_lesson_comment', pg_temp.uid(3), 1) = 1);
select pg_temp.check_rate('another learner still reports',
  pg_temp.writes_before_limit('write_report', pg_temp.uid(3), 1) = 1);
select pg_temp.check_rate('another learner still opens a ticket',
  pg_temp.writes_before_limit('write_ticket', pg_temp.uid(3), 1) = 1);
reset role;

-- Escrita confiável do banco (RPC que liga skillset.trusted_write) não conta,
-- nem para quem já estourou.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
select set_config('skillset.trusted_write', 'on', true);
set local role authenticated;
select pg_temp.check_rate('trusted database write is not limited',
  pg_temp.writes_before_limit('write_post', pg_temp.uid(2), 1) = 1);
reset role;

-- O servidor (service_role) não tem teto, nem gravando pelo aluno que estourou.
select pg_temp.act_as(pg_temp.uid(2), 'service_role');
set local role service_role;
select pg_temp.check_rate('server posts past the learner limit',
  pg_temp.writes_before_limit('write_post', pg_temp.uid(2), 21) = 21);
select pg_temp.check_rate('server replies past the learner limit',
  pg_temp.writes_before_limit('write_comment', pg_temp.uid(2), 121) = 121);
select pg_temp.check_rate('server writes lesson comments past the learner limit',
  pg_temp.writes_before_limit('write_lesson_comment', pg_temp.uid(2), 121) = 121);
select pg_temp.check_rate('server files reports past the learner limit',
  pg_temp.writes_before_limit('write_report', pg_temp.uid(2), 21) = 21);
select pg_temp.check_rate('server opens tickets past the learner limit',
  pg_temp.writes_before_limit('write_ticket', pg_temp.uid(2), 11) = 11);
reset role;

select name, passed from write_rate_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from write_rate_checks where not passed;
  if failures is not null then
    raise exception 'WRITE_RATE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

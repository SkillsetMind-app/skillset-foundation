\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Ferramentas de IA do professor:
--   1. teto mensal por plano: sem plano 2 h, concessão (conta da casa) vale
--      antes da assinatura, uso do mês passado não conta, e o pedido que
--      passaria do teto volta sem reserva;
--   2. browser não lê uso nem legenda e não chama a reserva;
--   3. quiz: aluno matriculado lê só o publicado; quem não é matriculado, nada;
--      o dono lê o rascunho; o mesmo id de aula em OUTRO curso é outra linha
--      (não toma a do dono) e não aparece para o aluno do primeiro curso.
begin;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('31140000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;

select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true),
  set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('skillset.trusted_write', 'on', true);
-- 1 = sem plano, 2 = Basic com concessão Pro, 3 = Starter com uso só no mês
-- passado, 4 = aluno matriculado, 5 = aluno sem matrícula, 6 = Pro com
-- concessão Basic (o plano pago maior vence).
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'ia-prof-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 6) n;
update public.users set roles = '["student","teacher"]', current_plan_id = null where uid = pg_temp.uid(1)::text;
update public.users set roles = '["student","teacher"]', current_plan_id = 'basic' where uid = pg_temp.uid(2)::text;
update public.users set roles = '["student","teacher"]', current_plan_id = 'starter' where uid = pg_temp.uid(3)::text;
update public.users set roles = '["student","teacher"]', current_plan_id = 'pro' where uid = pg_temp.uid(6)::text;
insert into public.plan_grants(uid, plan_id, reason) values
  (pg_temp.uid(2)::text, 'pro', 'smoke'), (pg_temp.uid(6)::text, 'basic', 'smoke');
insert into public.ai_usage(owner_id, course_id, lesson_id, kind, seconds, created_at)
values (pg_temp.uid(3)::text, 'smoke-ia-course', 'l1', 'transcribe', 7000, now() - interval '40 days');

insert into public.courses(id, owner_id, slug, title, summary, category, status, currency, price_amount_minor, modules)
values ('smoke-ia-course', pg_temp.uid(1)::text, 'smoke-ia-course', 'Smoke IA', 'Curso usado só por este smoke.',
  'smoke', 'draft', 'usd', 0,
  '[{"id":"m1","title":"Module","summary":"","lessons":[{"id":"l1","title":"Lesson","type":"video","description":""}]}]');
-- Outro professor copia o id da aula l1 para o curso dele.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency, price_amount_minor, modules)
values ('smoke-ia-copycat', pg_temp.uid(2)::text, 'smoke-ia-copycat', 'Smoke IA copy', 'Curso usado só por este smoke.',
  'smoke', 'draft', 'usd', 0,
  '[{"id":"m9","title":"Module","summary":"","lessons":[{"id":"l1","title":"Lesson","type":"video","description":""}]}]');
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
values (pg_temp.uid(4)::text || '__smoke-ia-course', pg_temp.uid(4)::text, 'smoke-ia-course', 'smoke-ia-course',
  'Smoke IA', 'smoke', '', 'active', 'admin');
insert into public.lesson_quizzes(lesson_id, course_id, owner_id, questions, status)
values ('l1', 'smoke-ia-course', pg_temp.uid(1)::text,
  '[{"question":"Q?","options":["a","b"],"answer":0,"explanation":"e"}]', 'draft');
insert into public.lesson_captions(lesson_id, language, course_id, owner_id, video_id, vtt)
values ('l1', 'en', 'smoke-ia-course', pg_temp.uid(1)::text, 'video-1', 'WEBVTT');
-- O upsert do copiador (mesma chave que a rota usa) cai na linha DELE.
insert into public.lesson_quizzes(lesson_id, course_id, owner_id, questions, status)
values ('l1', 'smoke-ia-copycat', pg_temp.uid(2)::text,
  '[{"question":"X?","options":["a","b"],"answer":1,"explanation":"x"}]', 'published')
on conflict (course_id, lesson_id) do update set questions = excluded.questions, status = excluded.status;
select set_config('skillset.trusted_write', 'off', true);

-- 1. Teto -----------------------------------------------------------------------
-- Um comando por reserva: cada uma tem de ver a anterior.
select usage_id is not null as first_hour_ok
  from public.claim_ai_video_seconds(pg_temp.uid(1)::text, 'smoke-ia-course', 'l1', 3600) \gset
select usage_id is null and used_seconds = 3600 and limit_seconds = 7200 as over_cap_refused
  from public.claim_ai_video_seconds(pg_temp.uid(1)::text, 'smoke-ia-course', 'l1', 3601) \gset
select usage_id is not null and used_seconds = 7200 as exact_cap_ok
  from public.claim_ai_video_seconds(pg_temp.uid(1)::text, 'smoke-ia-course', 'l1', 3600) \gset
select
  (select count(*) = 2 from public.ai_usage where owner_id = pg_temp.uid(1)::text) as refused_left_no_row,
  (select limit_seconds = 108000 from public.ai_video_usage(pg_temp.uid(2)::text)) as grant_wins,
  (select used_seconds = 0 and limit_seconds = 36000 from public.ai_video_usage(pg_temp.uid(3)::text)) as last_month_free,
  (select limit_seconds = 108000 from public.ai_video_usage(pg_temp.uid(6)::text)) as paid_beats_grant,
  (select count(*) = 2 and count(*) filter (where course_id = 'smoke-ia-course' and status = 'draft') = 1
     from public.lesson_quizzes where lesson_id = 'l1') as copy_is_separate_row
  \gset

-- 2. Browser ---------------------------------------------------------------------
select
  not has_function_privilege('authenticated', 'public.claim_ai_video_seconds(text,text,text,integer)', 'execute')
    and not has_function_privilege('anon', 'public.claim_ai_video_seconds(text,text,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.ai_video_usage(text)', 'execute')
    and has_function_privilege('service_role', 'public.claim_ai_video_seconds(text,text,text,integer)', 'execute')
    and not has_table_privilege('authenticated', 'public.ai_usage', 'select')
    and not has_table_privilege('authenticated', 'public.lesson_captions', 'select')
    and not has_table_privilege('authenticated', 'public.lesson_quizzes', 'insert')
    and has_table_privilege('service_role', 'public.lesson_captions', 'insert')
    and has_table_privilege('service_role', 'public.lesson_quizzes', 'update')
    and has_table_privilege('service_role', 'public.ai_usage', 'delete')
    as browser_locked \gset

-- 3. Quiz ------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
set local role authenticated;
select count(*) = 0 as student_no_draft from public.lesson_quizzes \gset
reset role;
select set_config('request.jwt.claim.role', 'service_role', true),
  set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.lesson_quizzes set status = 'published' where course_id = 'smoke-ia-course' and lesson_id = 'l1';

select pg_temp.act_as(pg_temp.uid(4));
set local role authenticated;
select count(*) = 1 and bool_and(course_id = 'smoke-ia-course') as student_sees_published from public.lesson_quizzes \gset
reset role;

select pg_temp.act_as(pg_temp.uid(5));
set local role authenticated;
select count(*) = 0 as stranger_sees_nothing from public.lesson_quizzes \gset
reset role;

select set_config('request.jwt.claim.role', 'service_role', true),
  set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.lesson_quizzes set status = 'draft' where course_id = 'smoke-ia-course' and lesson_id = 'l1';
select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select count(*) = 1 and bool_and(course_id = 'smoke-ia-course') as owner_sees_draft from public.lesson_quizzes \gset
reset role;

\if :first_hour_ok
\else
  \echo 'SMOKE_ASSERTION_FAILED: first hour of a creator without plan was refused'
  select 1/0;
\endif
\if :over_cap_refused
\else
  \echo 'SMOKE_ASSERTION_FAILED: a claim past the 2-hour cap was accepted'
  select 1/0;
\endif
\if :exact_cap_ok
\else
  \echo 'SMOKE_ASSERTION_FAILED: a claim landing exactly on the cap was refused'
  select 1/0;
\endif
\if :refused_left_no_row
\else
  \echo 'SMOKE_ASSERTION_FAILED: a refused claim wrote a usage row'
  select 1/0;
\endif
\if :grant_wins
\else
  \echo 'SMOKE_ASSERTION_FAILED: a Pro grant did not lift a Basic account to 30 hours'
  select 1/0;
\endif
\if :last_month_free
\else
  \echo 'SMOKE_ASSERTION_FAILED: last month usage counted against this month'
  select 1/0;
\endif
\if :paid_beats_grant
\else
  \echo 'SMOKE_ASSERTION_FAILED: a Basic grant cut a paid Pro account below 30 hours'
  select 1/0;
\endif
\if :copy_is_separate_row
\else
  \echo 'SMOKE_ASSERTION_FAILED: a lesson id copied into another course took over the owner quiz'
  select 1/0;
\endif
\if :browser_locked
\else
  \echo 'SMOKE_ASSERTION_FAILED: the browser can reach AI usage, captions or the claim'
  select 1/0;
\endif
\if :student_no_draft
\else
  \echo 'SMOKE_ASSERTION_FAILED: an enrolled student read a draft quiz'
  select 1/0;
\endif
\if :student_sees_published
\else
  \echo 'SMOKE_ASSERTION_FAILED: an enrolled student could not read the published quiz'
  select 1/0;
\endif
\if :stranger_sees_nothing
\else
  \echo 'SMOKE_ASSERTION_FAILED: a non-enrolled user read a quiz'
  select 1/0;
\endif
\if :owner_sees_draft
\else
  \echo 'SMOKE_ASSERTION_FAILED: the course owner could not read the draft quiz'
  select 1/0;
\endif
rollback;

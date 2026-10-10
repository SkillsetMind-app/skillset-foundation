\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Desde 20260927010000 a taxa de ativação é cobrada ao publicar. Com a
-- exigência ligada, o criador que não pagou cria rascunho, monta módulos e
-- aulas e salva; o Publicar (pela RPC ou escrevendo status direto) continua
-- recusado. Quem pagou publica.
begin;
create temp table publish_only_checks (name text, passed boolean);
grant insert, select on publish_only_checks to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into publish_only_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86650927-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(p_sql text, p_message text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm = p_message;
end $$;
-- Recusa com qualquer mensagem: a escrita direta de status pode cair antes no
-- guarda de campos; o que importa é não publicar.
create function pg_temp.refused_any(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return true;
end $$;
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;

-- 1 não pagou, 2 pagou. Ambos criadores com os termos aceitos.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'publish-only-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 2) n;
-- This smoke isolates activation/content; creator plans are already current.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from generate_series(1, 2) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      onboarding_completed = true
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 2) n);
update public.users set activation_fee_paid_at = now() where uid = pg_temp.uid(2)::text;
delete from public.platform_settings where key in ('require_activation_fee', 'require_creator_verification');
insert into public.platform_settings(key, value) values
  ('require_activation_fee', 'true'::jsonb), ('require_creator_verification', 'false'::jsonb);
select set_config('skillset.trusted_write', 'off', true);

create function pg_temp.build(n int) returns void language plpgsql as $$
declare v_id text;
begin
  v_id := public.create_teacher_course_draft(
    'Publish only ' || n, 'Curso usado só por este smoke da taxa ao publicar.', 'smoke',
    array['smoke'], 'free');
  perform set_config('smoke.course_' || n, v_id, true);
  perform public.update_teacher_course_builder(v_id, jsonb_build_object(
    'title', 'Publish only ' || n,
    'summary', 'Curso usado só por este smoke da taxa ao publicar.',
    'categories', jsonb_build_array('smoke'),
    'paymentType', 'free', 'priceAmountMinor', 0, 'currency', 'USD',
    'modules', jsonb_build_array(jsonb_build_object('id', 'm1', 'title', 'Modulo',
      'lessons', jsonb_build_array(jsonb_build_object('id', 'po-l1-' || n, 'title', 'Aula',
        'description', 'Aula', 'type', 'text', 'contentText', 'Conteudo da aula para o smoke.',
        'externalUrl', 'https://example.invalid/aula')))))
  );
end $$;

-- Sem pagar: rascunho, currículo e salvar passam.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('unpaid creator creates and builds a draft',
  pg_temp.passed('select pg_temp.build(1)'));
select pg_temp.check_gate('unpaid creator edits the draft directly',
  pg_temp.passed(format($q$update public.courses set updated_at = now() where id = %L$q$,
    current_setting('smoke.course_1', true))));
select pg_temp.check_gate('unpaid creator still sees the studio tour',
  public.claim_welcome_tour(pg_temp.uid(1)::text, 'teacher'));
-- Publicar continua fechado, pela RPC e pela escrita direta.
select pg_temp.check_gate('unpaid creator cannot publish through the RPC',
  pg_temp.refused(format('select public.publish_teacher_course(%L)', current_setting('smoke.course_1', true)),
    'Pay the one-time activation fee before publishing your first course.'));
select pg_temp.check_gate('unpaid creator cannot publish by writing status',
  pg_temp.refused_any(format($q$update public.courses set status = 'published' where id = %L$q$,
    current_setting('smoke.course_1', true))));
reset role;

-- O gatilho sozinho, sem a RPC e sem o guarda de campos na frente.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
select set_config('skillset.trusted_write', 'on', true);
select pg_temp.check_gate('trigger alone refuses the unpaid owner publishing',
  pg_temp.refused(format($q$update public.courses set status = 'published' where id = %L$q$,
    current_setting('smoke.course_1', true)),
    'Pay the one-time activation fee before publishing your first course.'));
select set_config('skillset.trusted_write', 'off', true);

-- Ativação revogada (estorno limpa activation_fee_paid_at): o dono não edita
-- mais o curso que ficou publicado.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.courses set status = 'published' where id = current_setting('smoke.course_1', true);
select set_config('skillset.trusted_write', 'off', true);
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('revoked creator cannot edit a course that stayed published',
  pg_temp.refused(format($q$select public.update_teacher_course_builder(%L, %L::jsonb)$q$,
    current_setting('smoke.course_1', true),
    jsonb_build_object('title', 'Publish only 1 edited',
      'summary', 'Curso usado só por este smoke da taxa ao publicar.',
      'categories', jsonb_build_array('smoke'),
      'paymentType', 'free', 'priceAmountMinor', 0, 'currency', 'USD',
      'modules', jsonb_build_array(jsonb_build_object('id', 'm1', 'title', 'Modulo',
        'lessons', jsonb_build_array(jsonb_build_object('id', 'po-l1-1', 'title', 'Aula',
          'description', 'Aula', 'type', 'text', 'contentText', 'Conteudo da aula para o smoke.',
          'externalUrl', 'https://example.invalid/aula')))))::text),
    'Pay the one-time activation fee before publishing your first course.'));
reset role;
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.courses set status = 'draft' where id = current_setting('smoke.course_1', true);
select set_config('skillset.trusted_write', 'off', true);

-- Quem pagou publica.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('paid creator builds a draft', pg_temp.passed('select pg_temp.build(2)'));
select pg_temp.check_gate('paid creator publishes',
  pg_temp.passed(format('select public.publish_teacher_course(%L)', current_setting('smoke.course_2', true))));
reset role;

select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('only the paid course is published',
  (select status from public.courses where id = current_setting('smoke.course_1', true)) <> 'published'
  and (select status from public.courses where id = current_setting('smoke.course_2', true)) = 'published');
select pg_temp.check_gate('every case ran', (select count(*) = 10 from publish_only_checks));

select name, passed from publish_only_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from publish_only_checks where not passed;
  if failures is not null then
    raise exception 'PUBLISH_ONLY_GATE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

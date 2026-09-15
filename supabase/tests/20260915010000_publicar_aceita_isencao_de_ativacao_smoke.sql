\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- A publicação usa a mesma porta da taxa que o rascunho, o vídeo, o cupom e o
-- checkout: com a exigência ligada, publicam quem pagou, quem tem isenção
-- pronta e admin; ficam de fora quem não pagou e quem tem isenção pendente.
-- Antes de 20260915010000 a isenção pronta era recusada no Publicar.
begin;
create temp table publish_checks (name text, passed boolean);
grant insert, select on publish_checks to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into publish_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86650915-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;

-- 1 sem ativação, 2 pagou, 3 isenção pronta, 4 admin sem taxa (concede as
-- isenções), 5 isenção pendente. Cada um com um rascunho grátis publicável.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'publish-gate-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 5) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 5) n);
update public.users set activation_fee_paid_at = now() where uid = pg_temp.uid(2)::text;
update public.users set roles = '["student","teacher","admin"]' where uid = pg_temp.uid(4)::text;
insert into public.creator_activation_waivers(uid, granted_by, ready_at) values
  (pg_temp.uid(3)::text, pg_temp.uid(4)::text, now()),
  (pg_temp.uid(5)::text, pg_temp.uid(4)::text, null);
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, modules)
select 'smoke-publish-gate-' || n, pg_temp.uid(n)::text, 'smoke-publish-gate-' || n,
  'Smoke publish gate ' || n, 'Curso usado só por este smoke de publicação.', 'smoke', 'draft', 'usd', 0,
  'free', '[{"id":"m1","title":"Modulo","lessons":[{"id":"l1","title":"Aula","type":"video"}]}]'::jsonb
from generate_series(1, 5) n;
delete from public.platform_settings where key in ('require_activation_fee', 'require_creator_verification');
insert into public.platform_settings(key, value) values
  ('require_activation_fee', 'true'::jsonb), ('require_creator_verification', 'false'::jsonb);

create function pg_temp.try_publish(n int, p_who text, p_allowed boolean) returns void language plpgsql as $$
declare stmt text := format('select public.publish_teacher_course(%L)', 'smoke-publish-gate-' || n);
begin
  perform pg_temp.check_gate(
    format('%s %s publish', p_who, case when p_allowed then 'can' else 'cannot' end),
    case when p_allowed then pg_temp.passed(stmt)
      else pg_temp.refused(stmt, 'Pay the one-time activation fee before publishing your first course.') end);
end $$;

select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.try_publish(1, 'creator without activation', false);
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.try_publish(2, 'creator who paid', true);
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.try_publish(3, 'creator with a ready waiver', true);
reset role;
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.try_publish(4, 'admin without the fee', true);
reset role;
select pg_temp.act_as(pg_temp.uid(5), 'authenticated');
set local role authenticated;
select pg_temp.try_publish(5, 'creator with a pending waiver', false);
reset role;

-- O que passou tem de estar publicado de fato; o que foi recusado, não.
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('published exactly the paid, the ready waiver and the admin',
  (select array_agg(id order by id) from public.courses
    where id like 'smoke-publish-gate-%' and status = 'published')
  = array['smoke-publish-gate-2', 'smoke-publish-gate-3', 'smoke-publish-gate-4']);
select pg_temp.check_gate('every case ran', (select count(*) = 6 from publish_checks));

select name, passed from publish_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from publish_checks where not passed;
  if failures is not null then
    raise exception 'PUBLISH_GATE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

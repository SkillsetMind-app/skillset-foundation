\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- P2-5: a ativação (#303) vale também no banco, não só na rota. Com a
-- exigência ligada, quem não pagou nem tem isenção pronta é recusado ao dar
-- acesso manual, criar cupom, ativar cupom e conectar domínio, mesmo chamando
-- a RPC direto pelo PostgREST. Quem pagou, quem tem isenção pronta e admin
-- passam. Com a exigência desligada, todos passam. Pausar cupom continua
-- valendo para quem foi barrado.
begin;
create temp table activation_checks (name text, passed boolean);
grant insert, select on activation_checks to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into activation_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86650000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal1')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true só quando a chamada foi recusada com esta mensagem; a que passou é desfeita.
create function pg_temp.refused(p_sql text, p_message text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm = p_message;
end $$;
-- true quando a chamada passou; a recusa inesperada vai para o log.
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;
-- As quatro portas, chamadas por quem está logado, como faria o PostgREST.
-- p_phase separa as duas rodadas: e-mail, código e domínio novos em cada uma.
create function pg_temp.try_gates(p_phase text, p_who text, n int, p_coupon uuid, p_allowed boolean)
returns void language plpgsql as $$
declare g record;
begin
  for g in select * from (values
    ('grant course access',
      format('select public.grant_course_access(%L, %L)', 'smoke-activation-gate-' || n,
        'gate-' || p_phase || '-' || n || '@example.test'),
      'Pay the one-time activation fee before granting course access.'),
    ('create a coupon',
      format('select public.create_course_coupon(%L, %L, 10, null, null)', 'smoke-activation-gate-' || n,
        'GATE' || upper(p_phase)),
      'Pay the one-time activation fee before creating coupons.'),
    ('activate a coupon',
      format('select public.set_course_coupon_active(%L, true)', p_coupon),
      'Pay the one-time activation fee before a coupon can be activated.'),
    ('connect a custom domain',
      format('select public.claim_custom_domain(%L)', 'gate-' || p_phase || '-' || n || '.example.test'),
      'Pay the one-time activation fee before connecting a custom domain.')
  ) as t(what, stmt, msg)
  loop
    perform pg_temp.check_gate(
      format('requirement %s: %s %s %s', p_phase, p_who,
        case when p_allowed then 'can' else 'cannot' end, g.what),
      case when p_allowed then pg_temp.passed(g.stmt) else pg_temp.refused(g.stmt, g.msg) end);
  end loop;
end $$;

-- 1 sem ativação, 2 pagou, 3 isenção pronta, 4 admin sem taxa (concede as
-- isenções), 5 isenção pendente. Cada um com curso publicado, plano com domínio
-- e um cupom pausado. A exigência de verificação fica desligada para isolar a
-- ativação.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'activation-gate-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 5) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      current_plan_id = 'pro'
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 5) n);
update public.users set activation_fee_paid_at = now() where uid = pg_temp.uid(2)::text;
update public.users set roles = '["student","teacher","admin"]' where uid = pg_temp.uid(4)::text;
insert into public.creator_activation_waivers(uid, granted_by, ready_at) values
  (pg_temp.uid(3)::text, pg_temp.uid(4)::text, now()),
  (pg_temp.uid(5)::text, pg_temp.uid(4)::text, null);
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency, price_amount_minor)
select 'smoke-activation-gate-' || n, pg_temp.uid(n)::text, 'smoke-activation-gate-' || n,
  'Smoke activation gate ' || n, 'Curso usado só por este smoke.', 'smoke', 'published', 'brl', 0
from generate_series(1, 5) n;
insert into public.course_coupons(course_id, owner_id, code, percent_off)
select 'smoke-activation-gate-' || n, pg_temp.uid(n)::text, 'SEEDED', 10 from generate_series(1, 5) n;
select id as coupon_1 from public.course_coupons where course_id = 'smoke-activation-gate-1' \gset
select id as coupon_2 from public.course_coupons where course_id = 'smoke-activation-gate-2' \gset
select id as coupon_3 from public.course_coupons where course_id = 'smoke-activation-gate-3' \gset
select id as coupon_4 from public.course_coupons where course_id = 'smoke-activation-gate-4' \gset
select id as coupon_5 from public.course_coupons where course_id = 'smoke-activation-gate-5' \gset
delete from public.platform_settings where key in ('require_activation_fee', 'require_creator_verification');
insert into public.platform_settings(key, value) values
  ('require_activation_fee', 'true'::jsonb), ('require_creator_verification', 'false'::jsonb);

-- Exigência ligada.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('on', 'creator without activation', 1, :'coupon_1', false);
select pg_temp.check_gate('requirement on: creator without activation can still pause a coupon',
  pg_temp.passed(format('select public.set_course_coupon_active(%L, false)', :'coupon_1')));
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('on', 'creator who paid', 2, :'coupon_2', true);
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('on', 'creator with a ready waiver', 3, :'coupon_3', true);
reset role;
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('on', 'admin without the fee', 4, :'coupon_4', true);
reset role;
select pg_temp.act_as(pg_temp.uid(5), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('on', 'creator with a pending waiver', 5, :'coupon_5', false);
reset role;

-- Exigência desligada: todos passam.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
update public.platform_settings set value = 'false'::jsonb where key = 'require_activation_fee';
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('off', 'creator without activation', 1, :'coupon_1', true);
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('off', 'creator who paid', 2, :'coupon_2', true);
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('off', 'creator with a ready waiver', 3, :'coupon_3', true);
reset role;
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('off', 'admin without the fee', 4, :'coupon_4', true);
reset role;
select pg_temp.act_as(pg_temp.uid(5), 'authenticated');
set local role authenticated;
select pg_temp.try_gates('off', 'creator with a pending waiver', 5, :'coupon_5', true);
reset role;

-- 5 contas x 4 portas x 2 rodadas + a pausa: nenhuma rodada pode sumir calada.
select pg_temp.check_gate('every gate ran in both rounds', (select count(*) = 41 from activation_checks));

select name, passed from activation_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from activation_checks where not passed;
  if failures is not null then
    raise exception 'ACTIVATION_GATE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

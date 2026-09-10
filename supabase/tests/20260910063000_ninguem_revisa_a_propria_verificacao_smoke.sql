\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- P2-7: quem revisa não decide o próprio caso de verificação de criador, nem
-- ops nem admin. A revisão do caso de outra pessoa continua funcionando.
begin;
create temp table self_review_checks (name text, passed boolean);
grant insert, select on self_review_checks to authenticated;
create function pg_temp.check_review(p_name text, p_ok boolean) returns void
language sql as $$ insert into self_review_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
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

-- 1 ops que também pediu verificação, 2 criador comum, 3 admin que também pediu.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'self-review-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 3) n;
update public.users set roles = '["student","teacher","ops"]' where uid = pg_temp.uid(1)::text;
update public.users set roles = '["student","teacher"]' where uid = pg_temp.uid(2)::text;
update public.users set roles = '["student","teacher","admin"]' where uid = pg_temp.uid(3)::text;
update public.users
  set teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke', creator_verification_status = 'pending'
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(2)::text, pg_temp.uid(3)::text);
insert into public.creator_verification_cases(creator_id, profession, registration_type, registration_id, registration_region)
select pg_temp.uid(n)::text, 'Psychologist', 'License', 'SMOKE-' || n, 'NY' from generate_series(1, 3) n;
select id as own_case from public.creator_verification_cases where creator_id = pg_temp.uid(1)::text \gset
select id as other_case from public.creator_verification_cases where creator_id = pg_temp.uid(2)::text \gset
select id as admin_case from public.creator_verification_cases where creator_id = pg_temp.uid(3)::text \gset

-- Ops, pela RPC que o painel usa.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_review('ops cannot approve the own verification case',
  pg_temp.refused(format('select public.review_creator_verification(%L, %L)', :'own_case', 'approved'),
    'You cannot review your own verification case.'));
select pg_temp.check_review('ops cannot reject the own verification case',
  pg_temp.refused(format('select public.review_creator_verification(%L, %L, %L)', :'own_case', 'rejected',
    'Synthetic rejection note.'), 'You cannot review your own verification case.'));
select pg_temp.check_review('ops can still review someone else''s case',
  (public.review_creator_verification(:'other_case', 'approved')->>'success')::boolean);
reset role;
select pg_temp.check_review('own case stays pending and unreviewed',
  (select status = 'pending' and reviewed_by is null
     from public.creator_verification_cases where id = :'own_case'));
select pg_temp.check_review('reviewed case records the reviewer',
  (select status = 'approved' and reviewed_by = pg_temp.uid(1)::text
     from public.creator_verification_cases where id = :'other_case'));

-- Admin também não decide o próprio caso.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_review('admin cannot approve the own verification case either',
  pg_temp.refused(format('select public.review_creator_verification(%L, %L)', :'admin_case', 'approved'),
    'You cannot review your own verification case.'));
reset role;

select name, passed from self_review_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from self_review_checks where not passed;
  if failures is not null then
    raise exception 'SELF_REVIEW_REGRESSION: %', failures;
  end if;
end $$;
rollback;

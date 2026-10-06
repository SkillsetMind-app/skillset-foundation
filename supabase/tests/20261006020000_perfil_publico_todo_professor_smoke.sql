\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Todo professor ganha perfil público
-- (20261006020000_perfil_publico_todo_professor.sql):
--   - professor com o cadastro completo e sem verificação aparece, sem o selo;
--   - professor sem o cadastro completo não aparece; aceitar os termos depois
--     publica; aluno que aceitou os termos não aparece;
--   - suspender ou bloquear pela RPC de admin tira do ar, restaurar devolve, e
--     escrever em users não traz um suspenso de volta;
--   - aprovado com caso aprovado continua com o selo;
--   - anon lê o perfil e continua sem ler nada privado.
begin;
create temp table profile_checks (name text, passed boolean);
grant insert, select on profile_checks to anon, authenticated;
create function pg_temp.check_profile(p_name text, p_ok boolean) returns void
language sql as $$ insert into profile_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61006200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.service() returns void language plpgsql as $$
begin
  perform pg_temp.act_as(null, 'service_role');
  perform set_config('skillset.trusted_write', 'on', true);
end $$;
create function pg_temp.listed(n int) returns boolean language sql as $$
  select exists (select 1 from public.public_profiles where uid = pg_temp.uid(n)::text);
$$;
create function pg_temp.account(n int, p_action text) returns boolean language sql as $$
  select (public.admin_set_account_control(pg_temp.uid(n)::text, p_action,
    'Synthetic public profile check')->>'suspended')::boolean = (p_action <> 'restore');
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
-- true só quando o banco recusou a escrita por privilégio.
create function pg_temp.write_denied(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;

-- 1 professor sem verificação · 2 professor sem os termos · 3 psicólogo aprovado
-- 4 professor com pedido pendente · 5 professor que será suspenso · 6 admin
-- 7 aluno que aceitou os termos · 8 conta suspensa que vira professor depois
select pg_temp.service();
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'perfil-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 8) n;
update public.users set roles = '["student","teacher"]', display_name = 'Perfil ' || right(uid, 1),
    teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 8) n where n in (1, 3, 4, 5));
update public.users set roles = '["student","teacher"]', display_name = 'Perfil 2'
  where uid = pg_temp.uid(2)::text;
update public.users set roles = '["student"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid = pg_temp.uid(7)::text;
update public.users set roles = '["student","admin"]' where uid = pg_temp.uid(6)::text;
-- Marcador privado: se aparecer na linha pública, vazou.
update public.users set phone_number = 'SMOKE-PRIVATE-PHONE'
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(2)::text, pg_temp.uid(3)::text);

insert into public.creator_verification_cases
  (creator_id, status, verification_kind, profession, registration_type, registration_id,
   registration_region, reviewed_at)
values (pg_temp.uid(3)::text, 'approved', 'psychologist', 'Psychologist', '', 'SMOKE-PRIVATE-REG', 'NY',
  '2026-09-01 12:00:00+00');
update public.users set creator_verification_status = 'approved' where uid = pg_temp.uid(3)::text;
update public.users set creator_verification_status = 'pending' where uid = pg_temp.uid(4)::text;

select pg_temp.check_profile('non-verified teacher with setup complete is listed', pg_temp.listed(1));
select pg_temp.check_profile('non-verified teacher carries no badge',
  (select not verified_professional and verification_kind is null and verified_at is null
     from public.public_profiles where uid = pg_temp.uid(1)::text));
select pg_temp.check_profile('pending teacher is listed without the badge',
  (select not verified_professional from public.public_profiles where uid = pg_temp.uid(4)::text));
select pg_temp.check_profile('approved teacher keeps the badge',
  (select verified_professional and verification_kind = 'license'
          and verified_at = '2026-09-01 12:00:00+00'
     from public.public_profiles where uid = pg_temp.uid(3)::text));
select pg_temp.check_profile('teacher without setup complete is not listed', not pg_temp.listed(2));
select pg_temp.check_profile('student who accepted the terms is not listed', not pg_temp.listed(7));
select pg_temp.check_profile('admin without the teacher role is not listed', not pg_temp.listed(6));

-- Aceitar os termos depois dispara a projeção (coluna nova no trigger).
update public.users set teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid = pg_temp.uid(2)::text;
select pg_temp.check_profile('accepting the terms later publishes the profile, without the badge',
  (select not verified_professional from public.public_profiles where uid = pg_temp.uid(2)::text));

-- Perder o papel tira do ar.
update public.users set roles = '["student"]' where uid = pg_temp.uid(4)::text;
select pg_temp.check_profile('losing the teacher role removes the profile', not pg_temp.listed(4));

-- Suspensão e bloqueio pelo caminho real: a RPC de admin, que só escreve em
-- account_controls.
select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
select pg_temp.check_profile('admin suspends through the account-control RPC', pg_temp.account(5, 'suspend'));
select pg_temp.check_profile('admin blocks through the account-control RPC', pg_temp.account(1, 'block'));
select pg_temp.check_profile('admin suspends an account that is not a teacher yet', pg_temp.account(8, 'suspend'));
reset role;
select pg_temp.check_profile('a suspended teacher is not listed', not pg_temp.listed(5));
select pg_temp.check_profile('a blocked teacher is not listed', not pg_temp.listed(1));

-- Escrever em users não traz o suspenso de volta, nem publica quem já entra suspenso.
select pg_temp.service();
update public.users set bio = 'Synthetic bio' where uid = pg_temp.uid(5)::text;
update public.users set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
    teacher_terms_version = 'smoke'
  where uid = pg_temp.uid(8)::text;
select pg_temp.check_profile('a profile write does not bring a suspended teacher back', not pg_temp.listed(5));
select pg_temp.check_profile('an account suspended before setup is not listed', not pg_temp.listed(8));

select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
select pg_temp.check_profile('admin restores through the account-control RPC', pg_temp.account(5, 'restore'));
reset role;
select pg_temp.check_profile('restoring the account brings the profile back', pg_temp.listed(5));

-- O criterio dito de novo, sem a função: nenhuma linha fora dele.
select pg_temp.check_profile('every listed fixture is a teacher with setup complete and not suspended',
  not exists (
    select 1 from public.public_profiles pp
    join public.users u on u.uid = pp.uid
    where pp.uid like '61006200-%'
      and (not u.roles ? 'teacher' or u.teacher_terms_accepted_at is null
        or exists (select 1 from public.account_controls c where c.uid = u.uid and c.suspended))));

-- Nada privado vira coluna pública.
select pg_temp.check_profile('public_profiles has no private column',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'public_profiles'
                 and column_name in ('email', 'phone_number', 'roles', 'creator_verification_status',
                                     'teacher_terms_accepted_at', 'teacher_terms_version',
                                     'stripe_customer_id', 'stripe_connected_account_id',
                                     'registration_id', 'onboarding_answers', 'preferences')));
select pg_temp.check_profile('anon and authenticated cannot call the projection functions',
  not has_function_privilege('anon', 'public.public_profile_eligible(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.project_public_profile(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sync_public_profile_on_account_control()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.project_public_profile(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.public_profile_eligible(text)', 'EXECUTE'));

-- Visitante anônimo.
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_profile('anon reads the non-verified teacher, without the badge',
  (select not verified_professional from public.public_profiles where uid = pg_temp.uid(2)::text));
select pg_temp.check_profile('anon reads the badge of the approved teacher',
  (select verified_professional from public.public_profiles where uid = pg_temp.uid(3)::text));
select pg_temp.check_profile('the public rows carry no private value',
  not exists (select 1 from public.public_profiles pp
               where pp.uid like '61006200-%'
                 and (to_jsonb(pp)::text like '%SMOKE-PRIVATE%'
                   or to_jsonb(pp)::text like '%@example.test%')));
select pg_temp.check_profile('anon cannot read the private users row',
  pg_temp.rows_or_denied(format(
    'select phone_number from public.users where uid = %L', pg_temp.uid(2)::text)) in (0, -1));
select pg_temp.check_profile('anon cannot read account controls',
  pg_temp.rows_or_denied('select uid from public.account_controls') in (0, -1));
select pg_temp.check_profile('anon cannot read verification cases',
  pg_temp.rows_or_denied(format(
    'select registration_id from public.creator_verification_cases where creator_id = %L',
    pg_temp.uid(3)::text)) in (0, -1));
select pg_temp.check_profile('anon cannot write public profiles',
  pg_temp.write_denied(format(
    'update public.public_profiles set verified_professional = false where uid = %L',
    pg_temp.uid(3)::text)));
reset role;

select name, passed from profile_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from profile_checks where not passed;
  if failures is not null then
    raise exception 'PUBLIC_PROFILE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

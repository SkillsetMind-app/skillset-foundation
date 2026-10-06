\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- Selo "profissional verificado" em public_profiles
-- (20261006010000_selo_profissional_verificado.sql):
--   - aprovado sai com o selo, a espécie e a data do caso; não aprovado, não;
--   - a aprovação pela RPC da fila e a correção direta do caso reprojetam;
--   - o selo não mexe em updated_at (o diretório ordena por ele);
--   - anon lê as colunas novas e continua sem ler o que é privado.
begin;
create temp table badge_checks (name text, passed boolean);
grant insert, select on badge_checks to anon, authenticated;
create function pg_temp.check_badge(p_name text, p_ok boolean) returns void
language sql as $$ insert into badge_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61006000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Número de linhas que a consulta devolveu, ou -1 se ela foi recusada.
create function pg_temp.rows_or_denied(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;
-- true só quando o banco recusou a escrita pela constraint; a que passou é desfeita.
create function pg_temp.violates_check(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when check_violation then return true;
  when sqlstate 'Z0001' then return false;
end $$;

-- 1 psicólogo aprovado · 2 professor sem pedido · 3 coach com pedido pendente
-- 4 aprovado na admissão antiga (legacy) · 5 aprovado sem caso · 6 ops que revisa
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'selo-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 6) n;
update public.users set roles = '["student","teacher"]', display_name = 'Selo ' || right(uid, 1)
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 5) n);
update public.users set roles = '["student","ops"]' where uid = pg_temp.uid(6)::text;

insert into public.creator_verification_cases
  (creator_id, status, verification_kind, profession, registration_type, registration_id,
   registration_region, reviewed_at)
values
  (pg_temp.uid(1)::text, 'approved', 'psychologist', 'Psychologist', '', 'SMOKE-REG-0001', 'NY',
   '2026-09-01 12:00:00+00'),
  (pg_temp.uid(3)::text, 'pending', 'coach', 'Coach', '', '', '', null);
-- Admissão antiga: espécie 'legacy' (default) e sem reviewed_at.
insert into public.creator_verification_cases
  (creator_id, status, profession, registration_type, registration_id, registration_region)
values (pg_temp.uid(4)::text, 'approved', 'Psychologist', 'Registry', 'SMOKE-REG-0004', 'NY');
update public.users set creator_verification_status = 'approved'
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text, pg_temp.uid(5)::text);
update public.users set creator_verification_status = 'pending' where uid = pg_temp.uid(3)::text;

select pg_temp.check_badge('approved psychologist gets the badge, kind and review date',
  (select verified_professional and verification_kind = 'psychologist'
          and verified_at = '2026-09-01 12:00:00+00'
     from public.public_profiles where uid = pg_temp.uid(1)::text));
select pg_temp.check_badge('teacher without a request is not projected as verified',
  not exists (select 1 from public.public_profiles
               where uid = pg_temp.uid(2)::text and verified_professional));
select pg_temp.check_badge('pending request is not projected as verified',
  not exists (select 1 from public.public_profiles
               where uid = pg_temp.uid(3)::text and verified_professional));
select pg_temp.check_badge('legacy approval shows the generic kind and the case date',
  (select verified_professional and verification_kind = 'other' and verified_at is not null
     from public.public_profiles where uid = pg_temp.uid(4)::text));
select pg_temp.check_badge('approval without a case is verified, generic and undated',
  (select verified_professional and verification_kind = 'other' and verified_at is null
     from public.public_profiles where uid = pg_temp.uid(5)::text));
select pg_temp.check_badge('the registration number never reaches the public row',
  not exists (select 1 from public.public_profiles pp
               where to_jsonb(pp)::text like '%SMOKE-REG%'));

-- A aprovação pelo caminho real: a RPC da fila, chamada por ops.
select id as coach_case from public.creator_verification_cases
  where creator_id = pg_temp.uid(3)::text \gset
select pg_temp.act_as(pg_temp.uid(6), 'authenticated');
set local role authenticated;
select pg_temp.check_badge('ops approves through the review RPC',
  (public.review_creator_verification(:'coach_case', 'approved')->>'success')::boolean);
reset role;
select pg_temp.check_badge('approval through the RPC projects the badge with the review date',
  (select pp.verified_professional and pp.verification_kind = 'coach'
          and pp.verified_at = c.reviewed_at
     from public.public_profiles pp
     join public.creator_verification_cases c on c.creator_id = pp.uid
    where pp.uid = pg_temp.uid(3)::text));

-- Correção direta no caso, sem tocar em users: o trigger novo reprojeta.
select updated_at as coach_updated_at from public.public_profiles
  where uid = pg_temp.uid(3)::text \gset
select pg_temp.act_as(null, 'service_role');
update public.creator_verification_cases set verification_kind = 'holistic'
  where id = :'coach_case';
select pg_temp.check_badge('fixing the case kind reprojects the badge',
  (select verification_kind = 'holistic' from public.public_profiles
    where uid = pg_temp.uid(3)::text));
select pg_temp.check_badge('the badge does not touch updated_at (directory order)',
  (select updated_at = :'coach_updated_at'::timestamptz from public.public_profiles
    where uid = pg_temp.uid(3)::text));

-- Saiu da aprovação: sai o selo (e, pelo critério de publicação, a linha).
select set_config('skillset.trusted_write', 'on', true);
update public.users set creator_verification_status = 'rejected' where uid = pg_temp.uid(1)::text;
select pg_temp.check_badge('losing the approval removes the badge',
  not exists (select 1 from public.public_profiles
               where uid = pg_temp.uid(1)::text and verified_professional));

-- O invariante vive no banco: selo sem espécie não grava.
select pg_temp.check_badge('constraint refuses a badge without a kind',
  pg_temp.violates_check(format(
    'update public.public_profiles set verification_kind = null where uid = %L', pg_temp.uid(4)::text)));
select pg_temp.check_badge('constraint refuses a kind without the badge',
  pg_temp.violates_check(format(
    'update public.public_profiles set verified_professional = false where uid = %L', pg_temp.uid(4)::text)));

-- Nada privado vira coluna pública.
select pg_temp.check_badge('public_profiles has no private verification column',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'public_profiles'
                 and column_name in ('registration_id', 'registration_region', 'registration_type',
                                     'evidence_links', 'document_path', 'profession', 'note',
                                     'review_note', 'reviewed_by', 'creator_verification_status')));
select pg_temp.check_badge('anon cannot call the badge functions',
  not has_function_privilege('anon', 'public.public_professional_badge(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.sync_public_professional_badge()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.public_professional_badge(text)', 'EXECUTE'));

-- Visitante anônimo.
select pg_temp.act_as(null, 'anon');
set local role anon;
select pg_temp.check_badge('anon reads the new columns',
  (select verified_professional and verification_kind = 'holistic' and verified_at is not null
     from public.public_profiles where uid = pg_temp.uid(3)::text));
select pg_temp.check_badge('anon cannot read verification cases',
  pg_temp.rows_or_denied(format(
    'select registration_id from public.creator_verification_cases where creator_id in (%L, %L)',
    pg_temp.uid(3)::text, pg_temp.uid(4)::text)) in (0, -1));
select pg_temp.check_badge('anon cannot read the private users row',
  pg_temp.rows_or_denied(format(
    'select creator_verification_status from public.users where uid = %L',
    pg_temp.uid(3)::text)) in (0, -1));
reset role;

select name, passed from badge_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from badge_checks where not passed;
  if failures is not null then
    raise exception 'PROFESSIONAL_BADGE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

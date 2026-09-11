\set ON_ERROR_STOP on
-- Banco descartavel. Fixtures e reversao sao desfeitas no rollback final.
begin;
\if :{?without_user_dossier_admin_gate}
-- Reversao da prova: a mesma funcao, sem o portao de admin e 2FA.
create or replace function public.admin_get_user_dossier(p_uid text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('identity', jsonb_build_object('uid', p_uid));
$$;
\endif

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'OPS_USER_DOSSIER_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('84000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.actor(n int, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n), 'role', 'authenticated',
    'aal', aal, 'session_id', pg_temp.uid(n + 100)::text)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(statement text, expected text, state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = state and sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'OPS_USER_DOSSIER_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;

-- Fixtures: 1 admin, 2 alvo (aluno e professor), 3 aluno, 4 admin suspenso.
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'ops-dossier-' || n || '@example.test',
  now(), '{}', '{}', now(), now() from generate_series(1, 4) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where id::text like '84000000-0000-4000-8000-%'
on conflict (uid) do nothing;
update public.users set roles = '["admin"]' where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);
update public.users set display_name = 'Dossier Target', roles = '["student","teacher"]',
  teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke', onboarding_path = 'teacher',
  onboarding_answers = '{"profession":"coach","primaryGoal":["sell"]}'::jsonb
  where uid = pg_temp.uid(2)::text;
insert into auth.sessions(id, user_id, created_at, updated_at)
select pg_temp.uid(n + 100), pg_temp.uid(n), now() - interval '1 hour', now() from generate_series(1, 4) n;
insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before)
values (pg_temp.uid(4)::text, true, null, now());
insert into public.courses(id, owner_id, slug, title, summary, category, status, payment_type, currency,
  price_amount_minor, created_at)
values ('ops-dossier-course', pg_temp.uid(2)::text, 'ops-dossier-course', 'Dossier fixture',
  'Synthetic draft.', 'smoke', 'draft', 'free', 'USD', 0, now());
insert into public.account_action_requests(id, type, requested_by, email, status, requested_at, updated_at)
values ('ops-dossier-request', 'account_deletion', pg_temp.uid(2)::text, 'ops-dossier-2@example.test',
  'pending', now(), now());
insert into public.audit_log(id, action, actor_id, actor_email, target_type, target_id, summary, metadata, created_at)
values (gen_random_uuid()::text, 'user.account_suspend', pg_temp.uid(1)::text, 'ops-dossier-1@example.test', 'user',
  pg_temp.uid(2)::text, 'user.account_suspend', jsonb_build_object('reason', 'Synthetic reason'), clock_timestamp());

-- 1) Aluno nao le o dossie de outra pessoa. A prova vermelha mira esta linha.
select pg_temp.actor(3);
set local role authenticated;
do $$
begin
  perform public.admin_get_user_dossier(pg_temp.uid(2)::text);
  raise exception 'OPS_USER_DOSSIER_REGRESSION: non-admin read another person';
exception when sqlstate '42501' then null;
end $$;
select pg_temp.refused($q$select * from public.admin_search_users()$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
reset role;

-- 2) Admin sem 2FA (aal1) e recusado nas duas.
select pg_temp.actor(1, 'aal1');
set local role authenticated;
select pg_temp.refused($q$select public.admin_get_user_dossier(pg_temp.uid(2)::text)$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
select pg_temp.refused($q$select * from public.admin_search_users()$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
reset role;

-- 3) Admin suspenso, mesmo com aal2, e recusado.
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.refused($q$select public.admin_get_user_dossier(pg_temp.uid(2)::text)$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
reset role;

-- 4) Admin com 2FA le o dossie inteiro, com os fatos das fixtures.
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.assert_true((select d ?& array['identity','onboarding','access','learning','behavior','timeline',
    'purchases','creator','community','support','privacy_requests','audit']
  from (select public.admin_get_user_dossier(pg_temp.uid(2)::text) as d) x), 'dossier missing a block');
select pg_temp.assert_true((select d #>> '{identity,display_name}' = 'Dossier Target'
    and d #>> '{onboarding,path}' = 'teacher'
    and d #>> '{onboarding,answers,profession}' = 'coach'
    and (d #>> '{creator,courses_by_status,draft}')::int = 1
    and d #>> '{timeline,0,kind}' = 'course_created'
    and (d #>> '{behavior,lessons_completed}')::int = 0
    and jsonb_array_length(d -> 'privacy_requests') = 1
    and jsonb_array_length(d #> '{audit,on_user}') = 1
    and d #>> '{audit,on_user,0,reason}' = 'Synthetic reason'
    and (d #>> '{access,sessions_since_cutoff}')::int = 1
    and (d #>> '{access,verified_factors}')::int = 0
    and not (d #>> '{identity,is_self}')::boolean
  from (select public.admin_get_user_dossier(pg_temp.uid(2)::text) as d) x), 'dossier facts wrong');
select pg_temp.assert_true((select d::text !~* '"[a-z_]*(secret|token|password|encrypted)[a-z_]*":'
  from (select public.admin_get_user_dossier(pg_temp.uid(2)::text) as d) x), 'dossier exposes a credential-shaped key');
select pg_temp.refused($q$select public.admin_get_user_dossier('does-not-exist')$q$, 'USER_DOSSIER_USER_MISSING', '23503');

-- 5) Lista: busca, total que ignora a pagina, filtros e filtro invalido.
select pg_temp.assert_true((select count(*) from public.admin_search_users('ops-dossier-')) = 4, 'search by email');
select pg_temp.assert_true((select max(total_count) from public.admin_search_users('ops-dossier-', null, null, 1, 0)) = 4,
  'total_count follows the filter, not the page');
select pg_temp.assert_true((select array_agg(uid) from public.admin_search_users('ops-dossier-', 'suspended'))
  = array[pg_temp.uid(4)::text], 'suspended filter');
select pg_temp.assert_true((select count(*) from public.admin_search_users('ops-dossier-', 'active', 'teacher')) = 1,
  'status and role filters combine');
select pg_temp.refused($q$select * from public.admin_search_users(null, 'deleted')$q$, 'USER_SEARCH_INVALID_FILTER', '22023');
reset role;
rollback;

\set ON_ERROR_STOP on
-- Banco descartável apenas. Fixtures voltam no ROLLBACK.
--
-- O teto Free do acesso manual vale no banco: um criador sem plano pago que
-- chama grant_course_access direto (como faria o PostgREST) passa 10 vezes no
-- dia e a 11ª é recusada com RATE_LIMIT. Um criador com plano pago faz 11 sem
-- recusa. E claim_checkout_lock segue só do servidor (achado da auditoria de
-- 23/10: na ordem dos arquivos o último grant é TO authenticated; produção e
-- este banco, que nasce do baseline de 21/07, estão certos — isto trava a volta).
begin;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('23100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Quantas das p_n chamadas passaram, parando na primeira recusa (que tem de ser RATE_LIMIT).
create function pg_temp.grants_until_refused(p_owner int, p_n int) returns int language plpgsql as $$
declare i int;
begin
  for i in 1..p_n loop
    begin
      perform public.grant_course_access('smoke-free-cap-' || p_owner, 'cap-' || p_owner || '-' || i || '@example.test');
    exception when others then
      if sqlerrm <> 'RATE_LIMIT' then raise exception 'SMOKE_ASSERTION_FAILED: unexpected refusal %', sqlerrm; end if;
      return i - 1;
    end;
  end loop;
  return p_n;
end $$;
grant execute on function pg_temp.grants_until_refused(int, int) to authenticated;

-- 1 = Free (sem current_plan_id), 2 = plano pago. Os dois pagaram a ativação.
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true),
  set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'free-cap-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 2) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now(), current_plan_id = null
  where uid = pg_temp.uid(1)::text;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now(), current_plan_id = 'basic'
  where uid = pg_temp.uid(2)::text;
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
values ('smoke-free-cap-plan', pg_temp.uid(2)::text, 'basic', 'active', now() + interval '1 day');
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency, price_amount_minor)
select 'smoke-free-cap-' || n, pg_temp.uid(n)::text, 'smoke-free-cap-' || n,
  'Smoke free cap ' || n, 'Curso usado só por este smoke.', 'smoke', 'published', 'brl', 0
from generate_series(1, 2) n;
delete from public.platform_settings where key in ('require_activation_fee', 'require_creator_verification');
insert into public.platform_settings(key, value) values
  ('require_activation_fee', 'false'::jsonb), ('require_creator_verification', 'false'::jsonb);
select set_config('skillset.trusted_write', 'off', true);

select pg_temp.act_as(pg_temp.uid(1));
set local role authenticated;
select pg_temp.grants_until_refused(1, 11) as free_passed \gset
reset role;

select pg_temp.act_as(pg_temp.uid(2));
set local role authenticated;
select pg_temp.grants_until_refused(2, 11) as paid_passed \gset
reset role;

select :free_passed = 10 as free_ok, :paid_passed = 11 as paid_ok,
  not has_function_privilege('authenticated', 'public.claim_checkout_lock(text,text,text,text,integer,integer)', 'execute')
    and not has_function_privilege('anon', 'public.claim_checkout_lock(text,text,text,text,integer,integer)', 'execute')
    and has_function_privilege('service_role', 'public.claim_checkout_lock(text,text,text,text,integer,integer)', 'execute')
    as lock_ok \gset
\if :free_ok
\else
  \echo 'SMOKE_ASSERTION_FAILED: Free creator passed' :free_passed 'grants (expected 10)'
  select 1/0;
\endif
\if :paid_ok
\else
  \echo 'SMOKE_ASSERTION_FAILED: paid creator passed' :paid_passed 'grants (expected 11)'
  select 1/0;
\endif
\if :lock_ok
\else
  \echo 'SMOKE_ASSERTION_FAILED: claim_checkout_lock is callable outside service_role'
  select 1/0;
\endif
rollback;

\set ON_ERROR_STOP on
-- Disposable database only. Fixtures go back on ROLLBACK.
--
-- P2-3 and P2-4: the storefront closes for a suspended owner and for an owner whose activation was
-- undone, when activation is required. An admin owner and a ready exemption keep
-- selling; a pending exemption does not. Only the service role asks.
begin;
create temp table seller_checks (name text, passed boolean);
create function pg_temp.check_seller(p_name text, p_ok boolean) returns void
language sql as $$ insert into seller_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'course-seller-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 7) n;
select set_config('skillset.trusted_write', 'on', true);
-- 1 paid; 2 had the fee refunded; 3 paid and is suspended; 4 admin without a
-- fee; 5 ready exemption; 6 pending exemption; 7 admin who grants exemptions.
-- This smoke isolates activation/content; creator plans are already current.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from generate_series(1, 6) n;
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 6) n);
update public.users set activation_fee_paid_at = now() where uid in (pg_temp.uid(1)::text, pg_temp.uid(3)::text);
update public.users set roles = '["student","teacher","admin"]' where uid = pg_temp.uid(4)::text;
update public.users set roles = '["admin"]' where uid = pg_temp.uid(7)::text;
insert into public.account_controls(uid, suspended, blocked_email, sessions_revoked_before)
  values (pg_temp.uid(3)::text, true, null, now());
insert into public.creator_activation_waivers(uid, granted_by, ready_at) values
  (pg_temp.uid(5)::text, pg_temp.uid(7)::text, now()),
  (pg_temp.uid(6)::text, pg_temp.uid(7)::text, null);
delete from public.platform_settings where key = 'require_activation_fee';
insert into public.platform_settings(key, value) values ('require_activation_fee', 'true'::jsonb);

select pg_temp.check_seller('paid creator can sell', public.course_owner_can_sell(pg_temp.uid(1)::text));
select pg_temp.check_seller('refunded activation cannot sell', not public.course_owner_can_sell(pg_temp.uid(2)::text));
select pg_temp.check_seller('suspended creator cannot sell', not public.course_owner_can_sell(pg_temp.uid(3)::text));
select pg_temp.check_seller('admin owner without activation fee can sell', public.course_owner_can_sell(pg_temp.uid(4)::text));
select pg_temp.check_seller('ready waiver can sell', public.course_owner_can_sell(pg_temp.uid(5)::text));
select pg_temp.check_seller('pending waiver cannot sell', not public.course_owner_can_sell(pg_temp.uid(6)::text));

-- Without required activation, only suspension closes the storefront.
update public.platform_settings set value = 'false'::jsonb where key = 'require_activation_fee';
select pg_temp.check_seller('without the activation requirement a refunded creator can sell',
  public.course_owner_can_sell(pg_temp.uid(2)::text));
select pg_temp.check_seller('without the activation requirement a suspended creator still cannot sell',
  not public.course_owner_can_sell(pg_temp.uid(3)::text));

select pg_temp.check_seller('only the server can ask',
  not has_function_privilege('anon', 'public.course_owner_can_sell(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.course_owner_can_sell(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.course_owner_can_sell(text)', 'EXECUTE'));

select name, passed from seller_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from seller_checks where not passed;
  if failures is not null then
    raise exception 'COURSE_SELLER_REGRESSION: %', failures;
  end if;
end $$;
rollback;

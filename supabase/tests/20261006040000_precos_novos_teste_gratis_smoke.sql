\set ON_ERROR_STOP on
-- Disposable database only. Nothing stays: everything goes back on ROLLBACK.
--
-- New prices + free trial (20261006040000_precos_novos_teste_gratis.sql):
--   - commission: free 1000, basic 1000, starter 490, pro 0 and plus (Enterprise) 0 (they were 290 and 190; 20261113010000);
--   - basic without highlights or domain (falls into the else);
--   - orders.platform_fee_fixed_minor exists, with default 0;
--   - pro with Plus's highlights and domains (5 and 5); landing stays 20;
--   - the search_path pins are still there after the create or replace;
--   - subscriptions.trial_end exists;
--   - creator_plan_trials: one row per account, RLS enabled and forced, and
--     anon/authenticated neither read nor write.
begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'SMOKE_ASSERTION_FAILED: %', p_message;
  end if;
end $$;

select pg_temp.assert_true(
  public.platform_fee_bps_for_plan('free') = 1000
    and public.platform_fee_bps_for_plan('basic') = 1000
    and public.platform_fee_bps_for_plan('starter') = 490
    and public.platform_fee_bps_for_plan('pro') = 0
    and public.platform_fee_bps_for_plan('plus') = 0
    and public.platform_fee_bps_for_plan(null) = 1000,
  'platform_fee_bps_for_plan is outside the new table'
);

select pg_temp.assert_true(
  public.featured_slots_for_plan(null) = 0
    and public.featured_slots_for_plan('basic') = 0
    and public.featured_slots_for_plan('starter') = 1
    and public.featured_slots_for_plan('pro') = 5
    and public.featured_slots_for_plan('plus') = 5,
  'featured_slots_for_plan is outside the new table'
);

select pg_temp.assert_true(
  public.custom_domain_limit_for_plan(null) = 0
    and public.custom_domain_limit_for_plan('basic') = 0
    and public.custom_domain_limit_for_plan('starter') = 1
    and public.custom_domain_limit_for_plan('pro') = 5
    and public.custom_domain_limit_for_plan('plus') = 5,
  'custom_domain_limit_for_plan is outside the new table'
);

select pg_temp.assert_true(
  public.landing_block_limit_for_plan('pro') = 20
    and public.landing_block_limit_for_plan('plus') = 20,
  'landing_block_limit_for_plan changed by accident'
);

select pg_temp.assert_true(
  'search_path=""' = any (coalesce(p.proconfig, '{}')),
  format('%s perdeu o search_path fixo', p.oid::regprocedure)
)
from pg_proc p
where p.oid in (
  'public.platform_fee_bps_for_plan(text)'::regprocedure,
  'public.custom_domain_limit_for_plan(text)'::regprocedure
);

select pg_temp.assert_true(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'trial_end'),
  'subscriptions.trial_end does not exist'
);

select pg_temp.assert_true(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'platform_fee_fixed_minor' and column_default = '0' and is_nullable = 'NO'),
  'orders.platform_fee_fixed_minor does not exist with default 0'
);

select pg_temp.assert_true(
  c.relrowsecurity and c.relforcerowsecurity,
  'creator_plan_trials without RLS enabled and forced'
)
from pg_class c
where c.oid = 'public.creator_plan_trials'::regclass;

select pg_temp.assert_true(
  not has_table_privilege(r, 'public.creator_plan_trials', 'select')
    and not has_table_privilege(r, 'public.creator_plan_trials', 'insert')
    and not has_table_privilege(r, 'public.creator_plan_trials', 'update'),
  format('%s can reach creator_plan_trials', r)
)
from unnest(array['anon', 'authenticated']) r;

select pg_temp.assert_true(
  exists (select 1 from pg_constraint
    where conrelid = 'public.creator_plan_trials'::regclass and contype = 'p'),
  'creator_plan_trials without a per-account primary key'
);

rollback;

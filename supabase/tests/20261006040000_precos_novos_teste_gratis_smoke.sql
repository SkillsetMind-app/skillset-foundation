\set ON_ERROR_STOP on
-- Banco descartável apenas. Nada fica: tudo volta no ROLLBACK.
--
-- Preços novos + teste grátis (20261006040000_precos_novos_teste_gratis.sql):
--   - comissão: free 1000, basic 1000, starter 490, pro 290, plus (Enterprise) 190;
--   - basic sem destaque nem domínio (cai no else);
--   - orders.platform_fee_fixed_minor existe, com default 0;
--   - pro com os destaques e domínios do Plus (5 e 5); landing segue 20;
--   - os pinos de search_path continuam lá depois do create or replace;
--   - subscriptions.trial_end existe;
--   - creator_plan_trials: uma linha por conta, RLS ligada e forçada, e
--     anon/authenticated não leem nem escrevem.
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
    and public.platform_fee_bps_for_plan('pro') = 290
    and public.platform_fee_bps_for_plan('plus') = 190
    and public.platform_fee_bps_for_plan(null) = 1000,
  'platform_fee_bps_for_plan fora da tabela nova'
);

select pg_temp.assert_true(
  public.featured_slots_for_plan(null) = 0
    and public.featured_slots_for_plan('basic') = 0
    and public.featured_slots_for_plan('starter') = 1
    and public.featured_slots_for_plan('pro') = 5
    and public.featured_slots_for_plan('plus') = 5,
  'featured_slots_for_plan fora da tabela nova'
);

select pg_temp.assert_true(
  public.custom_domain_limit_for_plan(null) = 0
    and public.custom_domain_limit_for_plan('basic') = 0
    and public.custom_domain_limit_for_plan('starter') = 1
    and public.custom_domain_limit_for_plan('pro') = 5
    and public.custom_domain_limit_for_plan('plus') = 5,
  'custom_domain_limit_for_plan fora da tabela nova'
);

select pg_temp.assert_true(
  public.landing_block_limit_for_plan('pro') = 20
    and public.landing_block_limit_for_plan('plus') = 20,
  'landing_block_limit_for_plan mudou sem querer'
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
  'subscriptions.trial_end nao existe'
);

select pg_temp.assert_true(
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'platform_fee_fixed_minor' and column_default = '0' and is_nullable = 'NO'),
  'orders.platform_fee_fixed_minor nao existe com default 0'
);

select pg_temp.assert_true(
  c.relrowsecurity and c.relforcerowsecurity,
  'creator_plan_trials sem RLS ligada e forcada'
)
from pg_class c
where c.oid = 'public.creator_plan_trials'::regclass;

select pg_temp.assert_true(
  not has_table_privilege(r, 'public.creator_plan_trials', 'select')
    and not has_table_privilege(r, 'public.creator_plan_trials', 'insert')
    and not has_table_privilege(r, 'public.creator_plan_trials', 'update'),
  format('%s alcanca creator_plan_trials', r)
)
from unnest(array['anon', 'authenticated']) r;

select pg_temp.assert_true(
  exists (select 1 from pg_constraint
    where conrelid = 'public.creator_plan_trials'::regclass and contype = 'p'),
  'creator_plan_trials sem chave primaria por conta'
);

rollback;

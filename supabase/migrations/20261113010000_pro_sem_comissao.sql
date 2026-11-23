-- Pro e Enterprise passam a 0% de comissão (decisão do dono, 13/11/2026).
--
-- A parte fixa (~US$0,30) também sai dos dois, mas ela não mora no banco: o
-- checkout grava o valor em orders.platform_fee_fixed_minor a partir de
-- platformFixedFeeMinor() (src/lib/payments/rules.ts). Aqui só o percentual.
--
--   1. platform_fee_bps_for_plan: pro 290 -> 0 e plus (Enterprise) 190 -> 0.
--      Basic e Starter não mudam.
--      Espelha canonicalPlatformFeeBpsForPlan em src/lib/payments/rules.ts.
--   2. courses.platform_fee_bps é refeito a partir do plano do dono, como na
--      20261006040000. As vendas antigas guardam a própria taxa no pedido.
--
-- Idempotente: create or replace + update só do que diverge.

-- 1. Comissão -----------------------------------------------------------------
create or replace function public.platform_fee_bps_for_plan(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case p_plan
    when 'free' then 1000
    when 'basic' then 1000
    when 'starter' then 490
    when 'pro' then 0
    when 'plus' then 0
    else 1000
  end;
$function$;

-- 2. Snapshot de comissão nos cursos ------------------------------------------
-- courses_freeze_privileged_columns() só deixa mexer em platform_fee_bps por
-- escrita confiável; mesma porta da 20261006040000.
select set_config('skillset.trusted_write', 'on', true);

update public.courses c
set platform_fee_bps = public.platform_fee_bps_for_plan(u.current_plan_id)
from public.users u
where u.uid = c.owner_id
  and c.platform_fee_bps is distinct from public.platform_fee_bps_for_plan(u.current_plan_id);

select set_config('skillset.trusted_write', 'off', true);

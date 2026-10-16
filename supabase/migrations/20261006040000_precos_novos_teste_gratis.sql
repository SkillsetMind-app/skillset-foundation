-- Nova tabela de preços (decisão do fundador, 06/10/2026). Não existe mais
-- plano gratuito na oferta: o que existe é o teste grátis de 14 dias.
--   - Básico (basic): US$ 5/mês, 10% + taxa fixa por venda;
--   - Starter: US$ 19/mês, 4,9% + taxa fixa (Recomendado);
--   - Pro: US$ 89/mês, 2,9% + taxa fixa, com os limites que eram do Plus;
--   - Enterprise (id `plus`, fora da oferta): US$ 199/mês, 1,9% + taxa fixa.
--   - A taxa fixa (~US$ 0,30 por venda, tabela por moeda em
--     src/lib/payments/rules.ts) vale para toda venda, avulsa ou renovação.
--   - `free` fica só como estado de conta sem assinatura, na taxa do Básico,
--     até a mudança que bloqueia vender sem plano.
--
-- O que muda aqui:
--   1. platform_fee_bps_for_plan: basic 1000, starter 490, pro 290, plus 190.
--      Espelha canonicalPlatformFeeBpsForPlan em src/lib/payments/rules.ts.
--   2. featured_slots_for_plan e custom_domain_limit_for_plan: pro sobe para 5
--      e 5, os números do Plus. Espelham planEntitlements em
--      src/domain/entitlements.ts (o teste de deriva lê ESTE arquivo).
--      basic cai no `else` das duas (0 e 0) e das outras funções de plano,
--      que já tratam todo plano diferente de `free` como pago.
--   3. orders.platform_fee_fixed_minor: a parte fixa da taxa, guardada no
--      pedido como o percentual já é (platform_fee_bps). Pedidos antigos: 0.
--   4. courses.platform_fee_bps é refeito a partir do plano do dono, como na
--      20260718000100. As vendas antigas guardam a própria taxa no pedido.
--   5. subscriptions.trial_end: a página de cobrança mostra "Teste grátis —
--      termina em {data}".
--   6. creator_plan_trials: um teste grátis por conta de criador, para sempre.
--      A linha nasce quando o webhook vê a primeira assinatura com trial e não
--      é apagada quando a assinatura acaba; o checkout consulta a tabela antes
--      de oferecer o trial. reminder_sent_at torna o e-mail de
--      customer.subscription.trial_will_end idempotente (um por assinatura).
--      Só a service role lê e escreve.
--
-- Idempotente: create or replace, add column if not exists, create table if
-- not exists.

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
    when 'pro' then 290
    when 'plus' then 190
    else 1000
  end;
$function$;

-- 2. Cotas que descem ao banco --------------------------------------------------
-- create or replace troca também os atributos: o SET de cada uma é repetido
-- igual ao que ela tem hoje (20260815000000 e 20260910060000).
create or replace function public.featured_slots_for_plan(p_plan_id text)
returns integer
language sql
immutable
set search_path = 'public', 'pg_temp'
as $function$
  select case coalesce(p_plan_id, 'free')
    when 'plus' then 5
    when 'pro' then 5
    when 'starter' then 1
    else 0
  end;
$function$;

create or replace function public.custom_domain_limit_for_plan(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_plan_id, 'free')
    when 'starter' then 1
    when 'pro'     then 5
    when 'plus'    then 5
    else 0            -- free e basic: nao incluso
  end;
$$;

-- 3. Parte fixa da taxa no pedido ----------------------------------------------
alter table public.orders
  add column if not exists platform_fee_fixed_minor integer not null default 0;

comment on column public.orders.platform_fee_fixed_minor is
  'Parte fixa da taxa da plataforma nesta venda, na unidade guardada (valor x 100). Soma-se a platform_fee_bps.';

-- 4. Snapshot de comissão nos cursos ------------------------------------------
-- courses_freeze_privileged_columns() só deixa mexer em platform_fee_bps por
-- escrita confiável; mesma porta da 20260718000100.
select set_config('skillset.trusted_write', 'on', true);

update public.courses c
set platform_fee_bps = public.platform_fee_bps_for_plan(u.current_plan_id)
from public.users u
where u.uid = c.owner_id
  and c.platform_fee_bps is distinct from public.platform_fee_bps_for_plan(u.current_plan_id);

select set_config('skillset.trusted_write', 'off', true);

-- 5. Fim do teste na assinatura do plano --------------------------------------
alter table public.subscriptions
  add column if not exists trial_end timestamptz;

-- 6. Um teste grátis por conta --------------------------------------------------
create table if not exists public.creator_plan_trials (
  user_id text primary key references public.users(uid) on delete cascade,
  stripe_subscription_id text not null unique,
  trial_end timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.creator_plan_trials is
  'Um teste grátis de plano por conta de criador. Escrito pelo webhook da Stripe; lido pelo checkout do plano. Só service role.';

alter table public.creator_plan_trials enable row level security;
alter table public.creator_plan_trials force row level security;
revoke all on public.creator_plan_trials from public, anon, authenticated;
grant select, insert, update on public.creator_plan_trials to service_role;
-- Toda tabela com RLS leva a trava restritiva de sessão (20260910030000):
-- conta suspensa ou sessão revogada não passa, mesmo que um dia ganhe policy de leitura.
drop policy if exists account_access_guard on public.creator_plan_trials;
create policy account_access_guard on public.creator_plan_trials as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

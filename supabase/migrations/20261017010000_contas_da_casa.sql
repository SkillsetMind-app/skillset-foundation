-- Concessão de plano sem assinatura (plan_grants).
--
-- Até aqui o plano só vinha do Stripe: o webhook recalcula users.current_plan_id
-- a partir das assinaturas vivas e cai em 'free' quando não há nenhuma. Uma conta
-- com concessão fica no plano concedido mesmo sem assinatura.
--
-- RLS ligada e nenhuma policy permissiva: só service_role ou SQL direto leem e
-- escrevem; nenhuma rota de API grava aqui. Quem lê: o webhook (via
-- service_role) e creator_has_current_plan (definer). As linhas entram por um
-- passo de operador, fora deste repositório, que é público.
-- uid é text porque users.uid é text (uuid não casaria com a chave estrangeira).

create table if not exists public.plan_grants (
  uid text primary key references public.users(uid) on delete cascade,
  plan_id text not null check (plan_id in ('free', 'basic', 'starter', 'pro', 'plus')),
  reason text not null,
  granted_at timestamptz not null default now()
);

alter table public.plan_grants enable row level security;
revoke all on table public.plan_grants from public, anon, authenticated;
-- A trava de sessão que toda tabela com RLS carrega (smoke 20260910030000).
create policy account_access_guard on public.plan_grants as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

-- A trava de publicação lia só assinaturas. Mesma função da 20261010010000,
-- copiada inteira; a ÚNICA mudança é aceitar a concessão.
create or replace function public.creator_has_current_plan(p_uid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.uid = p_uid and u.roles ? 'admin')
    or exists (
      select 1 from public.plan_grants g
      where g.uid = p_uid and g.plan_id in ('basic', 'starter', 'pro', 'plus')
    )
    or exists (
      select 1 from public.subscriptions s
      where s.user_id = p_uid
        and s.plan_id in ('basic', 'starter', 'pro', 'plus')
        and s.status in ('active', 'trialing')
        and s.current_period_end > now()
        and (s.status <> 'trialing' or s.trial_end > now())
    );
$$;
revoke all on function public.creator_has_current_plan(text) from public, anon, authenticated;
grant execute on function public.creator_has_current_plan(text) to service_role;

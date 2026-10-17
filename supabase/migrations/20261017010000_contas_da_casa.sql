-- Contas da casa: contas internas no plano Enterprise (plus) sem assinatura.
--
-- Até aqui o plano só vinha do Stripe: o webhook recalcula users.current_plan_id
-- a partir das assinaturas vivas e cai em 'free' quando não há nenhuma. As contas
-- do Patrick e do Eton (professor dos cursos da casa) ficavam "sem plano": 20
-- vídeos por dia, taxa de 10% e publicação bloqueada (17/10/2026).
--
-- plan_grants é a lista dessas contas. RLS ligada e NENHUMA policy: só
-- service_role ou SQL direto leem e escrevem; nenhuma rota de API grava aqui.
-- Quem lê: o webhook (via service_role) e creator_has_current_plan (definer).
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

-- As três contas da casa. O select pula uid que não existe neste banco
-- (staging, banco local), em vez de quebrar a migration na chave estrangeira.
insert into public.plan_grants (uid, plan_id, reason)
select u.uid, 'plus', 'conta da casa'
from public.users u
where u.uid in (
  'ea65eedd-a788-4a6b-8a41-efa3073ac36f', -- Eton
  '8cb8f7c3-3dd2-4b59-b190-9688b7ab1fd2', -- Patrick (simon@)
  '6d28f315-84e2-479c-b272-47177a0a9f27'  -- Patrick (opatricksimon@)
)
on conflict (uid) do nothing;

-- Sem assinatura, nenhum evento do Stripe vai chegar para essas contas, então o
-- plano é aplicado aqui. users_field_guard() e courses_freeze_privileged_columns()
-- só deixam mexer nesses campos por escrita confiável (mesma porta da 20261006040000).
-- Tudo num bloco só: aplicada comando a comando (psql do CI), a flag local
-- da transação já teria caído antes do update.
do $$
begin
  perform set_config('skillset.trusted_write', 'on', true);

  update public.users u
  set current_plan_id = g.plan_id, updated_at = now()
  from public.plan_grants g
  where g.uid = u.uid
    and u.current_plan_id is distinct from g.plan_id;

  update public.courses c
  set platform_fee_bps = public.platform_fee_bps_for_plan(g.plan_id)
  from public.plan_grants g
  where g.uid = c.owner_id
    and c.platform_fee_bps is distinct from public.platform_fee_bps_for_plan(g.plan_id);

  perform set_config('skillset.trusted_write', 'off', true);
end;
$$;

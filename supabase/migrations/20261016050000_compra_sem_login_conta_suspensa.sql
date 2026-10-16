-- A compra sem login pergunta se a conta achada pelo e-mail esta impedida de
-- entrar: suspensa em account_controls (e-mail bloqueado implica suspensa,
-- pela constraint da tabela) ou banida no Auth (banned_until no futuro).
-- Conta assim nao compra: depois de pagar, nao conseguiria entrar.
-- O service_role nao le account_controls (de proposito, 20260910030000); esta
-- funcao responde so sim ou nao, e so para ele.

create or replace function public.guest_buyer_account_blocked(p_uid text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.account_controls c
    where c.uid = p_uid and c.suspended
  ) or exists (
    select 1 from auth.users u
    where u.id::text = p_uid and u.banned_until > now()
  );
$$;

revoke all on function public.guest_buyer_account_blocked(text) from public, anon, authenticated;
grant execute on function public.guest_buyer_account_blocked(text) to service_role;

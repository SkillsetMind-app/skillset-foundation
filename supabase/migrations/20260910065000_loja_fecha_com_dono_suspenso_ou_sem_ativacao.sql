-- O checkout vendia curso de criador suspenso ou com a ativação desfeita.
--
-- P2-3 e P2-4 da auditoria de permissões de 10/09. A rota de checkout olhava o
-- status do curso e o Connect do dono, mas não se o dono estava suspenso
-- (account_controls, #326) nem se a ativação dele tinha sido desfeita: o
-- reembolso ou chargeback da taxa limpa activation_fee_paid_at, e o curso
-- publicado seguia vendendo até o criador mexer nele.
--
-- A service role não lê account_controls (de propósito, #326). Então a rota
-- pergunta a um predicado só dela se o dono pode vender: não, se estiver
-- suspenso; não, se a ativação for exigida e ele não tiver pago nem tiver
-- isenção pronta. Admin dono de curso segue isento da ativação, como na
-- publicação. creator_activation_blocked sozinho não serviria: chamado pela
-- service role, ele confere se QUEM CHAMA é admin, e ninguém chama.
create function public.course_owner_can_sell(p_owner_uid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
      select 1 from public.account_controls c where c.uid = p_owner_uid and c.suspended)
    and (exists (select 1 from public.users u where u.uid = p_owner_uid and u.roles ? 'admin')
      or not public.creator_activation_blocked(p_owner_uid));
$$;
revoke all on function public.course_owner_can_sell(text) from public, anon, authenticated;
grant execute on function public.course_owner_can_sell(text) to service_role;

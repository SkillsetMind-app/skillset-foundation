-- ============================================================================
-- PRÉ-VOO — rode ISTO ANTES de aplicar 20260724000100_drop_affiliate_coproducer.sql
-- ============================================================================
-- Este arquivo NÃO altera nada. É só leitura. Pode rodar à vontade.
--
-- ONDE RODAR:
--   https://supabase.com/dashboard/project/ijtikldtjvsbtwszokvs/sql/new
--   (Supabase → seu projeto → SQL Editor → New query → cola tudo → Run)
--
-- O QUE VOCÊ PRECISA VER PARA PODER SEGUIR:
--   coprodutores = 0   E   afiliados_ativos = 0
--
-- Se qualquer um vier > 0, PARE. Aquelas pessoas têm um acordo de divisão de
-- receita com você que a plataforma não consegue mais honrar — depois do pivô
-- não existe saldo nosso de onde pagá-las. Elas precisam ser acertadas por fora
-- ANTES de a tabela sumir, e a query 3 abaixo te dá a lista com nome e e-mail.
-- ============================================================================

-- 1) O número que decide tudo.
select
  (select count(*) from public.course_coproducers)                       as coprodutores,
  (select count(*) from public.course_commerce_settings
    where affiliate_enabled)                                             as afiliados_ativos,
  (select count(*) from public.payout_ledger)                            as linhas_no_ledger,
  (select count(*) from public.payout_ledger
    where release_at is not null and status <> 'settled')                as ledger_ainda_retido;

-- 2) Se "ledger_ainda_retido" for > 0, estas são vendas do modelo antigo que a
--    plataforma prometeu liberar e nunca liberou. Elas NÃO somem com a migração
--    (payout_ledger é preservada), mas você precisa saber que existem: esse
--    dinheiro ficou na Stripe da plataforma e é dívida sua com o professor.
select id, teacher_id, course_id, status, release_at,
       net_amount_minor, currency, created_at
from public.payout_ledger
where release_at is not null
  and status <> 'settled'
order by created_at asc
limit 100;

-- 3) Se "coprodutores" for > 0, esta é a lista de gente para acertar por fora.
select cc.id,
       cc.course_id,
       c.title            as curso,
       cc.invitee_email   as email_do_coprodutor,
       cc.revenue_share_pct as percentual_prometido,
       cc.status,
       cc.created_at
from public.course_coproducers cc
left join public.courses c on c.id = cc.course_id
order by cc.created_at asc;

-- 4) Se "afiliados_ativos" for > 0, estes são os cursos com programa de afiliado
--    ligado. Avise os donos antes de desligar — para eles, isso é uma promessa
--    comercial sendo retirada.
select s.course_id,
       c.title                      as curso,
       c.owner_id                   as dono,
       s.affiliate_commission_pct   as comissao_prometida,
       s.affiliate_approval         as aprovacao
from public.course_commerce_settings s
left join public.courses c on c.id = s.course_id
where s.affiliate_enabled
order by s.updated_at desc;

-- 5) Sanidade do pivô: toda venda paga precisa ter a conta Stripe do professor
--    congelada no pedido. Se "pedidos_sem_conta" for > 0, esses pedidos NÃO
--    conseguem ser reembolsados pelo painel (a rota de reembolso exige a conta).
select count(*) filter (where teacher_stripe_connected_account_id is null)
         as pedidos_sem_conta,
       count(*) as pedidos_pagos
from public.orders
where status in ('paid', 'refunded', 'partially_refunded');

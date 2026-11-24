-- Pedido pela sessão da Stripe.
--
-- O webhook acha o pedido pela sessão gravada nele (orders.checkout_session_id)
-- quando o metadata da sessão, que o professor com painel completo pode editar,
-- não aponta o pedido certo, e para reconhecer a venda que o professor faz
-- fora da plataforma. Sem índice, cada busca lê a tabela inteira.
--
-- Único e parcial: uma sessão da Stripe pertence a um pedido só (só o servidor
-- grava a coluna, com o id que a Stripe devolve), e as linhas sem sessão ficam
-- de fora. Único também impede que a busca por sessão ache dois pedidos.
--
-- Antes de aplicar, conferir que não há sessão repetida:
--   select checkout_session_id, count(*) from public.orders
--   where checkout_session_id is not null
--   group by 1 having count(*) > 1;
-- (vazio = pode aplicar)

create unique index if not exists orders_checkout_session_id_key
  on public.orders (checkout_session_id)
  where checkout_session_id is not null;

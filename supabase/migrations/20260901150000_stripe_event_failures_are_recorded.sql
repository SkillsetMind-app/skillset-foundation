-- Uma falha no webhook do Stripe não deixava rastro em lugar nenhum.
--
-- O único tratamento é `catch (error) { console.error(...) }` em
-- src/app/api/webhooks/stripe/route.ts:1614. O registro em
-- processed_stripe_events fica em 'processing' para sempre, e a tabela não tem
-- onde guardar o motivo. Medido em produção:
--
--   status      total  mais antigo               dias
--   done           15  2026-07-27 08:36:58+00    36.4
--   processing      1  2026-08-16 17:42:36+00    16.0
--
-- evt_1U584tPvg1vJW0IjS4Rmxyjj está preso há 16 dias e nada em lugar algum
-- aponta para ele. Desta vez não houve dano — o banco tem 0 pedidos, 0
-- pagamentos e 0 matrículas, então foi um evento de teste. Mas este é o caminho
-- que transforma dinheiro em curso entregue: entre `orders.status='paid'` e a
-- inserção da matrícula existe uma janela em que o comprador pagou e não tem
-- acesso. Com venda real, a única pista seria uma linha de console que ninguém
-- lê.
--
-- Stripe reentrega um 500 por cerca de 3 dias e depois desiste. Passado isso, o
-- evento existe apenas aqui — e aqui ele era indistinguível de um que morreu no
-- meio por deploy.
--
-- Estas colunas não consertam a falha; tornam-na VISÍVEL, que é o que faltava.
-- Um evento em 'failed' com mensagem e contagem de tentativas pode ser
-- consultado, alertado e reprocessado.

ALTER TABLE public.processed_stripe_events
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.processed_stripe_events.last_error IS
  'Mensagem do último erro de processamento. Preenchida no catch do handler; nula quando o evento conclui.';
COMMENT ON COLUMN public.processed_stripe_events.attempts IS
  'Quantas vezes o Stripe reentregou este evento. Valor alto com status <> done indica falha persistente.';

-- Índice parcial: a consulta que importa é "o que está pendente ou falhou", e
-- ela precisa ser barata para caber num alerta periódico.
CREATE INDEX IF NOT EXISTS processed_stripe_events_unresolved_idx
  ON public.processed_stripe_events (claimed_at)
  WHERE status <> 'done';

-- Visão para operação: eventos que merecem olho humano. Fica em SECURITY
-- INVOKER (padrão) — quem consulta precisa dos próprios privilégios, e a tabela
-- só é acessível pelo service role.
CREATE OR REPLACE VIEW public.stripe_events_needing_attention AS
SELECT
  stripe_event_id,
  status,
  attempts,
  last_error,
  claimed_at,
  failed_at,
  round(extract(epoch FROM (now() - claimed_at)) / 3600, 1) AS horas_parado
FROM public.processed_stripe_events
WHERE status <> 'done'
  -- 15 minutos de folga: um evento recém-reivindicado ainda pode estar em voo.
  AND claimed_at < now() - interval '15 minutes'
ORDER BY claimed_at;

COMMENT ON VIEW public.stripe_events_needing_attention IS
  'Eventos do Stripe que não concluíram. Vazia é o estado saudável; qualquer linha aqui significa que alguém pode ter pago sem receber acesso.';

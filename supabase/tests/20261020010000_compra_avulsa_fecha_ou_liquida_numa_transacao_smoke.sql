\set ON_ERROR_STOP on

-- Somente no banco descartavel de testes: cria dados e um gatilho de falha.
-- ROLLBACK limpa o fixture, mas nao torna a execucao segura em producao.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition boolean,
  p_message text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', p_message;
  END IF;
END;
$$;

-- O que esta sessao prova, no banco de verdade: anon e authenticated nao
-- executam; service_role executa; fechar e liquidar mudam pedido, reserva,
-- cupom e lock juntos; uma falha no meio desfaz tudo; as duas ordens
-- (fecha->paga, paga->fecha) e a repeticao sao seguras.
--
-- O que NAO prova: duas transacoes concorrentes de verdade. psql numa sessao
-- so nao agenda concorrencia e este runner nao tem um segundo cliente. A
-- ordem dos locks fica conferida por definicao na migration; a disputa real
-- e exercitada separadamente em scripts/check-order-concurrency.mjs.

SELECT c.id AS course_id, c.owner_id AS buyer_id
  FROM public.courses c
  JOIN public.users u ON u.uid = c.owner_id
 ORDER BY c.id
 LIMIT 1
\gset
SELECT :'buyer_id' || '__' || :'course_id' AS lock_key
\gset

-- 1) So service_role executa.
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.close_unpaid_course_order(text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.close_unpaid_course_order(text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.settle_paid_course_order(text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.settle_paid_course_order(text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finalize_course_coupon_reservation(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finalize_course_coupon_reservation(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.close_unpaid_course_order(text, text, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.settle_paid_course_order(text, text, text, text, text)', 'EXECUTE'),
  'order transitions must be service_role only'
);

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.close_unpaid_course_order('smoke_priv', 'cs_smoke_priv', 'cancelled', NULL);
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: anon closed an order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.settle_paid_course_order('smoke_priv', 'cs_smoke_priv', 'pi_smoke', NULL, NULL);
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: anon settled an order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.close_unpaid_course_order('smoke_priv', 'cs_smoke_priv', 'cancelled', NULL);
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: authenticated closed an order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.settle_paid_course_order('smoke_priv', 'cs_smoke_priv', 'pi_smoke', NULL, NULL);
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: authenticated settled an order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- Linhas reais: um cupom, seis pedidos e as reservas deles.
INSERT INTO public.course_coupons (id, course_id, owner_id, code, percent_off, max_redemptions, redeemed_count, active)
VALUES ('5e0c0de0-0000-4000-8000-000000000001', :'course_id', :'buyer_id', 'SMOKE-ATOMICO', 10, 10, 0, true);

INSERT INTO public.orders (id, user_id, course_id, amount_minor, currency, status, checkout_session_id, payout_model, teacher_stripe_connected_account_id)
SELECT o.id, :'buyer_id', :'course_id', 9000, 'USD', o.status, 'cs_' || o.id, 'direct_charge', 'acct_smoke'
  FROM (VALUES
    ('smoke_fecha', 'pending'),
    ('smoke_paga', 'pending'),
    ('smoke_falha', 'pending'),
    ('smoke_velho', 'pending'),
    ('smoke_legado', 'pending'),
    ('smoke_reembolso', 'refunded')
  ) AS o(id, status);

INSERT INTO public.course_coupon_reservations (order_id, coupon_id, user_id, status, expires_at)
SELECT o.id, '5e0c0de0-0000-4000-8000-000000000001', :'buyer_id', o.status, now() + interval '1 hour'
  FROM (VALUES
    ('smoke_fecha', 'reserved'),
    ('smoke_paga', 'reserved'),
    ('smoke_falha', 'reserved'),
    ('smoke_velho', 'reserved'),
    ('smoke_legado', 'redeemed'),
    ('smoke_reembolso', 'redeemed')
  ) AS o(id, status);

-- 2) Fecha, repete, e o pago atrasado nao ressuscita nada.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_fecha')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_fecha', 'cs_smoke_fecha', 'cancelled', 'acct_smoke') AS fecha_1
\gset
SELECT public.close_unpaid_course_order('smoke_fecha', 'cs_smoke_fecha', 'cancelled', 'acct_smoke') AS fecha_2
\gset
SELECT public.settle_paid_course_order('smoke_fecha', 'cs_smoke_fecha', 'pi_smoke_fecha', 'acct_smoke', NULL) AS fecha_paga
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'fecha_1' = 'closed' AND :'fecha_2' = 'closed' AND :'fecha_paga' = 'closed',
  'close is idempotent and a later paid event reports the contradiction'
);
SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_fecha') = 'cancelled'
  AND (SELECT payment_intent_id FROM public.orders WHERE id = 'smoke_fecha') IS NULL
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_fecha') = 'released'
  AND NOT EXISTS (SELECT 1 FROM public.checkout_locks WHERE lock_key = :'lock_key')
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 0,
  'close releases coupon and own lock together; paid after close resurrects nothing'
);

-- 3) Paga, repete, outro pagamento e recusado, e o fechamento atrasado nao rebaixa.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_paga')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_paga', 'cs_smoke_paga', 'pi_smoke_paga', 'acct_smoke', 'https://receipt.example/smoke') AS paga_1
\gset
RESET ROLE;

-- Recua paid_at para provar que a repeticao nao o move (now() e fixo na transacao).
UPDATE public.orders SET paid_at = '2026-01-01T00:00:00Z' WHERE id = 'smoke_paga';

SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_paga', 'cs_smoke_paga', 'pi_smoke_paga', 'acct_smoke', NULL) AS paga_2
\gset
SELECT public.close_unpaid_course_order('smoke_paga', 'cs_smoke_paga', 'failed', 'acct_smoke') AS paga_fecha
\gset
DO $$
BEGIN
  PERFORM public.settle_paid_course_order('smoke_paga', 'cs_smoke_paga', 'pi_outro', 'acct_smoke', NULL);
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: a different payment replaced the paid one';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ORDER_PAYMENT_CONFLICT' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'paga_1' = 'settled' AND :'paga_2' = 'paid' AND :'paga_fecha' = 'settled',
  'settle, replay and late close report the fresh status'
);
SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_paga') = 'paid'
  AND (SELECT payment_intent_id FROM public.orders WHERE id = 'smoke_paga') = 'pi_smoke_paga'
  AND (SELECT receipt_url FROM public.orders WHERE id = 'smoke_paga') = 'https://receipt.example/smoke'
  AND (SELECT paid_at FROM public.orders WHERE id = 'smoke_paga') = '2026-01-01T00:00:00Z'::timestamptz
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_paga') = 'redeemed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_paga'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'settle redeems once and marks paid together; replay keeps paid_at; late close keeps everything'
);

-- 4) Falha no ultimo passo desfaz o que veio antes, nas duas funcoes.
CREATE FUNCTION public.smoke_falha_no_meio() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = current_setting('smoke.falhar_pedido', true) THEN
    RAISE EXCEPTION 'SMOKE_GATILHO';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER smoke_falha_no_meio BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.smoke_falha_no_meio();
SELECT set_config('smoke.falhar_pedido', 'smoke_falha', true);

INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_falha')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.close_unpaid_course_order('smoke_falha', 'cs_smoke_falha', 'cancelled', 'acct_smoke');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: close survived a failure midway';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SMOKE_GATILHO' THEN RAISE; END IF;
END;
$$;
DO $$
BEGIN
  PERFORM public.settle_paid_course_order('smoke_falha', 'cs_smoke_falha', 'pi_smoke_falha', 'acct_smoke', NULL);
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: settle survived a failure midway';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SMOKE_GATILHO' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_falha') = 'pending'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_falha') = 'reserved'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_falha'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'a failure at the last write rolls back coupon, reservation and lock'
);

SELECT set_config('smoke.falhar_pedido', '', true);
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_falha', 'cs_smoke_falha', 'cancelled', 'acct_smoke') AS falha_fecha
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'falha_fecha' = 'closed'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_falha') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.checkout_locks WHERE lock_key = :'lock_key'),
  'the retry after the failure closes the order'
);

-- 5) Lock de uma tentativa mais nova sobrevive ao fechamento da antiga.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_novo')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_velho', 'cs_smoke_velho', 'cancelled', 'acct_smoke') AS velho
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'velho' = 'closed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_novo'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_velho') = 'released',
  'closing an old attempt keeps the newer owner lock'
);

-- 6) Pendente com cupom ja resgatado (caminho antigo) esta liquidando: nao fecha.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_legado')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_legado', 'cs_smoke_legado', 'failed', 'acct_smoke') AS legado_fecha
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'legado_fecha' = 'settling'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_legado') = 'pending'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_legado') = 'redeemed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_legado',
  'a pending order with a redeemed coupon is settling, not abandoned'
);
SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_legado', 'cs_smoke_legado', 'pi_smoke_legado', 'acct_smoke', NULL) AS legado_paga
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'legado_paga' = 'settled'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_legado') = 'paid'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'finishing a legacy settlement does not count the coupon twice'
);

-- 7) Sessao/conta divergente e pedido inexistente.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_args text[][] := ARRAY[
    ARRAY['cs_outro', 'acct_smoke'],
    ARRAY['cs_smoke_velho', 'acct_outro'],
    ARRAY['cs_smoke_velho', NULL]
  ];
  i integer;
BEGIN
  FOR i IN 1..array_length(v_args, 1) LOOP
    BEGIN
      PERFORM public.close_unpaid_course_order('smoke_velho', v_args[i][1], 'cancelled', v_args[i][2]);
      RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: close accepted a mismatched binding';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'CHECKOUT_ORDER_MISMATCH' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.settle_paid_course_order('smoke_velho', v_args[i][1], 'pi_x', v_args[i][2], NULL);
      RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: settle accepted a mismatched binding';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'CHECKOUT_ORDER_MISMATCH' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;
SELECT public.close_unpaid_course_order('smoke_inexistente', 'cs_x', 'cancelled', NULL) AS inexistente
\gset
RESET ROLE;
SELECT pg_temp.assert_true(:'inexistente' = 'missing', 'an unknown order is a no-op');

-- 8) Reembolsado nao volta a paid nem e fechado.
SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_reembolso', 'cs_smoke_reembolso', 'pi_smoke_reembolso', 'acct_smoke', NULL) AS reembolso_paga
\gset
SELECT public.close_unpaid_course_order('smoke_reembolso', 'cs_smoke_reembolso', 'cancelled', 'acct_smoke') AS reembolso_fecha
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'reembolso_paga' = 'refunded' AND :'reembolso_fecha' = 'settled'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_reembolso') = 'refunded',
  'a refunded order is neither resurrected nor closed'
);

-- 9) finalize: solta continua recusada; resgatada continua sem contar de novo.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.finalize_course_coupon_reservation('smoke_fecha');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: a released reservation was redeemed';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'COUPON_RESERVATION_RELEASED' THEN RAISE; END IF;
END;
$$;
SELECT public.finalize_course_coupon_reservation('smoke_paga');
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'finalize stays idempotent and refuses a released reservation'
);

ROLLBACK;

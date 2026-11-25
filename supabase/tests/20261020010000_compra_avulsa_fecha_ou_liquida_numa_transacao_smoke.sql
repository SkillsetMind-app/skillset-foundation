\set ON_ERROR_STOP on

-- Only on the disposable test database: it creates data and a failure trigger.
-- ROLLBACK cleans the fixture, but does not make the run safe in production.
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

-- What this session proves, on the real database: anon and authenticated do not
-- execute; service_role executes; closing and settling change order, reservation,
-- coupon and lock together; a failure in the middle undoes everything; both orders
-- (close->pay, pay->close) and the repeat are safe.
--
-- What it does NOT prove: two truly concurrent transactions. psql in a single session
-- does not schedule concurrency and this runner has no second client. The
-- lock order is checked by definition in the migration; the real contention
-- is exercised separately in scripts/check-order-concurrency.mjs.

SELECT c.id AS course_id, c.owner_id AS buyer_id
  FROM public.courses c
  JOIN public.users u ON u.uid = c.owner_id
 ORDER BY c.id
 LIMIT 1
\gset
SELECT :'buyer_id' || '__' || :'course_id' AS lock_key
\gset

-- 1) Only service_role executes.
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

-- Real rows: one coupon, six orders and their reservations.
INSERT INTO public.course_coupons (id, course_id, owner_id, code, percent_off, max_redemptions, redeemed_count, active)
VALUES ('5e0c0de0-0000-4000-8000-000000000001', :'course_id', :'buyer_id', 'SMOKE-ATOMIC', 10, 10, 0, true);

INSERT INTO public.orders (id, user_id, course_id, amount_minor, currency, status, checkout_session_id, payout_model, teacher_stripe_connected_account_id)
SELECT o.id, :'buyer_id', :'course_id', 9000, 'USD', o.status, 'cs_' || o.id, 'direct_charge', 'acct_smoke'
  FROM (VALUES
    ('smoke_close', 'pending'),
    ('smoke_paid', 'pending'),
    ('smoke_fail', 'pending'),
    ('smoke_stale', 'pending'),
    ('smoke_legacy', 'pending'),
    ('smoke_refund', 'refunded')
  ) AS o(id, status);

INSERT INTO public.course_coupon_reservations (order_id, coupon_id, user_id, status, expires_at)
SELECT o.id, '5e0c0de0-0000-4000-8000-000000000001', :'buyer_id', o.status, now() + interval '1 hour'
  FROM (VALUES
    ('smoke_close', 'reserved'),
    ('smoke_paid', 'reserved'),
    ('smoke_fail', 'reserved'),
    ('smoke_stale', 'reserved'),
    ('smoke_legacy', 'redeemed'),
    ('smoke_refund', 'redeemed')
  ) AS o(id, status);

-- 2) Close, repeat, and a late payment resurrects nothing.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_close')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_close', 'cs_smoke_close', 'cancelled', 'acct_smoke') AS close_1
\gset
SELECT public.close_unpaid_course_order('smoke_close', 'cs_smoke_close', 'cancelled', 'acct_smoke') AS close_2
\gset
SELECT public.settle_paid_course_order('smoke_close', 'cs_smoke_close', 'pi_smoke_close', 'acct_smoke', NULL) AS paid_after_close
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'close_1' = 'closed' AND :'close_2' = 'closed' AND :'paid_after_close' = 'closed',
  'close is idempotent and a later paid event reports the contradiction'
);
SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_close') = 'cancelled'
  AND (SELECT payment_intent_id FROM public.orders WHERE id = 'smoke_close') IS NULL
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_close') = 'released'
  AND NOT EXISTS (SELECT 1 FROM public.checkout_locks WHERE lock_key = :'lock_key')
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 0,
  'close releases coupon and own lock together; paid after close resurrects nothing'
);

-- 3) Pay, repeat, another payment is refused, and a late close does not downgrade.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_paid')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_paid', 'cs_smoke_paid', 'pi_smoke_paid', 'acct_smoke', 'https://receipt.example/smoke') AS settle_1
\gset
RESET ROLE;

-- Move paid_at back to prove the repeat does not move it (now() is fixed in the transaction).
UPDATE public.orders SET paid_at = '2026-01-01T00:00:00Z' WHERE id = 'smoke_paid';

SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_paid', 'cs_smoke_paid', 'pi_smoke_paid', 'acct_smoke', NULL) AS settle_2
\gset
SELECT public.close_unpaid_course_order('smoke_paid', 'cs_smoke_paid', 'failed', 'acct_smoke') AS close_after_paid
\gset
DO $$
BEGIN
  PERFORM public.settle_paid_course_order('smoke_paid', 'cs_smoke_paid', 'pi_other', 'acct_smoke', NULL);
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: a different payment replaced the paid one';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ORDER_PAYMENT_CONFLICT' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'settle_1' = 'settled' AND :'settle_2' = 'paid' AND :'close_after_paid' = 'settled',
  'settle, replay and late close report the fresh status'
);
SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_paid') = 'paid'
  AND (SELECT payment_intent_id FROM public.orders WHERE id = 'smoke_paid') = 'pi_smoke_paid'
  AND (SELECT receipt_url FROM public.orders WHERE id = 'smoke_paid') = 'https://receipt.example/smoke'
  AND (SELECT paid_at FROM public.orders WHERE id = 'smoke_paid') = '2026-01-01T00:00:00Z'::timestamptz
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_paid') = 'redeemed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_paid'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'settle redeems once and marks paid together; replay keeps paid_at; late close keeps everything'
);

-- 4) A failure in the last step undoes what came before, in both functions.
CREATE FUNCTION public.smoke_fail_midway() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = current_setting('smoke.fail_order', true) THEN
    RAISE EXCEPTION 'SMOKE_TRIGGER';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER smoke_fail_midway BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.smoke_fail_midway();
SELECT set_config('smoke.fail_order', 'smoke_fail', true);

INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_fail')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.close_unpaid_course_order('smoke_fail', 'cs_smoke_fail', 'cancelled', 'acct_smoke');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: close survived a failure midway';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SMOKE_TRIGGER' THEN RAISE; END IF;
END;
$$;
DO $$
BEGIN
  PERFORM public.settle_paid_course_order('smoke_fail', 'cs_smoke_fail', 'pi_smoke_fail', 'acct_smoke', NULL);
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: settle survived a failure midway';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SMOKE_TRIGGER' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT status FROM public.orders WHERE id = 'smoke_fail') = 'pending'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_fail') = 'reserved'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_fail'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'a failure at the last write rolls back coupon, reservation and lock'
);

SELECT set_config('smoke.fail_order', '', true);
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_fail', 'cs_smoke_fail', 'cancelled', 'acct_smoke') AS close_after_fail
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'close_after_fail' = 'closed'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_fail') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.checkout_locks WHERE lock_key = :'lock_key'),
  'the retry after the failure closes the order'
);

-- 5) The lock of a newer attempt survives the closing of the old one.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_newer')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_stale', 'cs_smoke_stale', 'cancelled', 'acct_smoke') AS stale_close
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'stale_close' = 'closed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_newer'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_stale') = 'released',
  'closing an old attempt keeps the newer owner lock'
);

-- 6) Pending with an already redeemed coupon (old path) is settling: it does not close.
INSERT INTO public.checkout_locks (lock_key, user_id, course_id, order_id)
VALUES (:'lock_key', :'buyer_id', :'course_id', 'smoke_legacy')
ON CONFLICT (lock_key) DO UPDATE SET order_id = EXCLUDED.order_id;
SET LOCAL ROLE service_role;
SELECT public.close_unpaid_course_order('smoke_legacy', 'cs_smoke_legacy', 'failed', 'acct_smoke') AS legacy_close
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'legacy_close' = 'settling'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_legacy') = 'pending'
  AND (SELECT status FROM public.course_coupon_reservations WHERE order_id = 'smoke_legacy') = 'redeemed'
  AND (SELECT order_id FROM public.checkout_locks WHERE lock_key = :'lock_key') = 'smoke_legacy',
  'a pending order with a redeemed coupon is settling, not abandoned'
);
SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_legacy', 'cs_smoke_legacy', 'pi_smoke_legacy', 'acct_smoke', NULL) AS legacy_settle
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'legacy_settle' = 'settled'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_legacy') = 'paid'
  AND (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'finishing a legacy settlement does not count the coupon twice'
);

-- 7) Mismatched session/account and nonexistent order.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_args text[][] := ARRAY[
    ARRAY['cs_other', 'acct_smoke'],
    ARRAY['cs_smoke_stale', 'acct_other'],
    ARRAY['cs_smoke_stale', NULL]
  ];
  i integer;
BEGIN
  FOR i IN 1..array_length(v_args, 1) LOOP
    BEGIN
      PERFORM public.close_unpaid_course_order('smoke_stale', v_args[i][1], 'cancelled', v_args[i][2]);
      RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: close accepted a mismatched binding';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'CHECKOUT_ORDER_MISMATCH' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.settle_paid_course_order('smoke_stale', v_args[i][1], 'pi_x', v_args[i][2], NULL);
      RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: settle accepted a mismatched binding';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'CHECKOUT_ORDER_MISMATCH' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;
SELECT public.close_unpaid_course_order('smoke_nonexistent', 'cs_x', 'cancelled', NULL) AS nonexistent_close
\gset
RESET ROLE;
SELECT pg_temp.assert_true(:'nonexistent_close' = 'missing', 'an unknown order is a no-op');

-- 8) Refunded does not go back to paid nor is it closed.
SET LOCAL ROLE service_role;
SELECT public.settle_paid_course_order('smoke_refund', 'cs_smoke_refund', 'pi_smoke_refund', 'acct_smoke', NULL) AS refund_settle
\gset
SELECT public.close_unpaid_course_order('smoke_refund', 'cs_smoke_refund', 'cancelled', 'acct_smoke') AS refund_close
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'refund_settle' = 'refunded' AND :'refund_close' = 'settled'
  AND (SELECT status FROM public.orders WHERE id = 'smoke_refund') = 'refunded',
  'a refunded order is neither resurrected nor closed'
);

-- 9) finalize: loose stays refused; redeemed still does not count again.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.finalize_course_coupon_reservation('smoke_close');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: a released reservation was redeemed';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'COUPON_RESERVATION_RELEASED' THEN RAISE; END IF;
END;
$$;
SELECT public.finalize_course_coupon_reservation('smoke_paid');
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT redeemed_count FROM public.course_coupons WHERE id = '5e0c0de0-0000-4000-8000-000000000001') = 1,
  'finalize stays idempotent and refuses a released reservation'
);

ROLLBACK;

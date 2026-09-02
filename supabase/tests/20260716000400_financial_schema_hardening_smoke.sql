\set ON_ERROR_STOP on

-- Run only against a disposable database after applying the hardening migration.
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

SELECT pg_temp.assert_true(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.payout_ledger'::regclass),
  'payout_ledger must have RLS enabled'
);
SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.payout_ledger', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.payout_ledger', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.payout_ledger', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.payout_ledger', 'DELETE'),
  'authenticated may read own payouts but may not write payout_ledger'
);
SELECT pg_temp.assert_true(
  has_table_privilege('service_role', 'public.payout_ledger', 'INSERT,UPDATE,DELETE'),
  'service_role must retain payout_ledger write access'
);

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_payout_transfer_reversal(text,text,numeric)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_payout_transfer_reversal(text,text,numeric)',
    'EXECUTE'
  ),
  'claim_payout_transfer_reversal must be service-role-only'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.complete_payout_transfer_reversal(text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_payout_transfer_reversal(text,text,text)',
    'EXECUTE'
  ),
  'complete_payout_transfer_reversal must be service-role-only'
);

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_checkout_lock(text,text,text,text,integer,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_checkout_lock(text,text,text,text,integer,integer)',
    'EXECUTE'
  ),
  'claim_checkout_lock must be service-role-only'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.enforce_rate_limit(text,integer,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.enforce_rate_limit(text,integer,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.enforce_rate_limit(text,integer,integer)',
    'EXECUTE'
  ),
  'enforce_rate_limit must be service-role-only'
);

-- is_service_role() lê o claim do JWT, não o papel do Postgres: numa chamada com
-- a chave de serviço o PostgREST manda os dois. O teste mandava só o papel, então
-- server_write_only() recusava a escrita e o caminho positivo nunca era
-- exercido -- ninguém percebeu porque este arquivo nunca tinha sido executado.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_action text;
  v_claimed_at timestamptz;
BEGIN
  DELETE FROM public.checkout_locks
  WHERE lock_key = 'hardening-smoke-user__hardening-smoke-course';

  SELECT action INTO v_action
  FROM public.claim_checkout_lock(
    'hardening-smoke-user',
    'hardening-smoke-course',
    'hardening-smoke-order',
    '2099-01-01T00:00:00Z',
    60000,
    5000
  );

  SELECT claimed_at INTO v_claimed_at
  FROM public.checkout_locks
  WHERE lock_key = 'hardening-smoke-user__hardening-smoke-course';

  IF v_action <> 'claim' THEN
    RAISE EXCEPTION 'Expected checkout lock action claim, got %', v_action;
  END IF;
  IF abs(extract(epoch FROM (clock_timestamp() - v_claimed_at))) > 10 THEN
    RAISE EXCEPTION 'claim_checkout_lock trusted caller-provided time';
  END IF;

  UPDATE public.checkout_locks
  SET claimed_at = clock_timestamp() - interval '6 minutes',
      expires_at = clock_timestamp() + interval '40 minutes',
      checkout_url = NULL
  WHERE lock_key = 'hardening-smoke-user__hardening-smoke-course';

  SELECT action INTO v_action
  FROM public.claim_checkout_lock(
    'hardening-smoke-user',
    'hardening-smoke-course',
    'hardening-smoke-subscription-order',
    '2099-01-01T00:00:00Z',
    60 * 60 * 1000,
    35 * 60 * 1000
  );
  IF v_action <> 'wait' THEN
    RAISE EXCEPTION
      'A 35-minute subscription grace was truncated; expected wait, got %',
      v_action;
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_first jsonb;
  v_redelivery jsonb;
  v_second jsonb;
  v_noop jsonb;
  v_completed jsonb;
  v_done_redelivery jsonb;
  v_ledger public.payout_ledger%ROWTYPE;
BEGIN
  DELETE FROM public.payout_ledger
  WHERE id = 'hardening-smoke-reversal-ledger';
  -- O fixture abaixo nunca tinha sido validado contra o schema real, porque
  -- este arquivo nunca tinha sido executado: faltavam as três colunas NOT NULL
  -- sem default (amount_minor, currency, status) e o dono referenciado pela FK
  -- payout_ledger.teacher_id -> public.users(uid). Tudo desfeito no ROLLBACK.
  INSERT INTO public.users (uid, email, display_name)
  VALUES (
    'hardening-smoke-owner',
    'hardening-smoke-owner@ci.local',
    'Hardening Smoke Owner'
  )
  ON CONFLICT (uid) DO NOTHING;

  INSERT INTO public.payout_ledger (
    id,
    teacher_id,
    amount_minor,
    currency,
    status,
    transfer_amount_minor,
    transfer_reversed_amount_minor,
    refund_reversal_claims
  ) VALUES (
    'hardening-smoke-reversal-ledger',
    'hardening-smoke-owner',
    100,
    'brl',
    'paid',
    100,
    0,
    '{}'::jsonb
  );

  v_first := public.claim_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-30',
    30
  );
  v_redelivery := public.claim_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-30',
    30
  );
  v_second := public.claim_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-60',
    60
  );
  v_noop := public.claim_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-60-noop',
    60
  );

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = 'hardening-smoke-reversal-ledger';

  IF (v_first->>'plannedAmountMinor')::numeric <> 30
     OR (v_first->>'planned_amount_minor')::numeric <> 30
     OR v_first->>'action' <> 'execute'
     OR v_first->>'state' <> 'pending'
     OR (v_first->>'shouldExecute')::boolean IS NOT true THEN
    RAISE EXCEPTION 'First reversal claim contract mismatch: %', v_first;
  END IF;
  IF (v_redelivery->>'plannedAmountMinor')::numeric <> 30
     OR (v_redelivery->>'planned_amount_minor')::numeric <> 30
     OR v_redelivery->>'action' <> 'execute'
     OR v_redelivery->>'state' <> 'pending'
     OR (v_redelivery->>'redelivery')::boolean IS NOT true THEN
    RAISE EXCEPTION 'Reversal redelivery changed its reservation: %', v_redelivery;
  END IF;
  IF (v_second->>'plannedAmountMinor')::numeric <> 30
     OR (v_second->>'planned_amount_minor')::numeric <> 30
     OR v_second->>'action' <> 'execute'
     OR v_ledger.transfer_reversed_amount_minor <> 60 THEN
    RAISE EXCEPTION
      'Cumulative 30/60 claims did not reserve exactly 60: second=%, ledger=%',
      v_second,
      v_ledger.transfer_reversed_amount_minor;
  END IF;
  IF (v_noop->>'planned_amount_minor')::numeric <> 0
     OR v_noop->>'action' <> 'skip'
     OR v_noop->>'state' <> 'done' THEN
    RAISE EXCEPTION 'Zero-delta reversal claim did not skip: %', v_noop;
  END IF;

  v_completed := public.complete_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-30',
    'trr_hardening_smoke_30'
  );
  PERFORM public.complete_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-30',
    'trr_hardening_smoke_30'
  );
  v_done_redelivery := public.claim_payout_transfer_reversal(
    'hardening-smoke-reversal-ledger',
    'refund-30',
    30
  );

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = 'hardening-smoke-reversal-ledger';
  IF v_completed->>'state' <> 'done'
     OR v_ledger.latest_transfer_reversal_id <> 'trr_hardening_smoke_30'
     OR v_ledger.refund_reversal_claims->'refund-30'->>'state' <> 'done'
     OR v_ledger.transfer_reversed_amount_minor <> 60 THEN
    RAISE EXCEPTION 'Reversal completion contract mismatch: %', v_completed;
  END IF;
  IF v_done_redelivery->>'action' <> 'skip'
     OR (v_done_redelivery->>'planned_amount_minor')::numeric <> 30
     OR (v_done_redelivery->>'redelivery')::boolean IS NOT true THEN
    RAISE EXCEPTION 'Completed reversal redelivery did not skip: %', v_done_redelivery;
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.processed_stripe_events'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'stripe_event_id'
  ),
  'processed_stripe_events.stripe_event_id must be unique'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.course_title_keys'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'title_key'
  ),
  'course_title_keys.title_key must be unique'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.course_lesson_content'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'lesson_id'
  ),
  'course_lesson_content.lesson_id must be unique'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.lesson_progress'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 2
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'enrollment_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'lesson_id'
  ),
  'lesson_progress(enrollment_id, lesson_id) must be unique'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.course_subscriptions'::regclass
      AND i.indisunique
      AND i.indpred IS NOT NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 2
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'user_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'course_id'
  ),
  'course_subscriptions must have a partial unique user/course index'
);

DO $$
DECLARE
  v_status text;
  v_suffix text;
BEGIN
  FOREACH v_status IN ARRAY ARRAY[
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused'
  ] LOOP
    v_suffix := replace(v_status, '_', '-');
    DELETE FROM public.course_subscriptions
    WHERE id IN (
      'hardening-smoke-sub-' || v_suffix || '-a',
      'hardening-smoke-sub-' || v_suffix || '-b'
    );

    INSERT INTO public.course_subscriptions (id, user_id, course_id, status)
    VALUES (
      'hardening-smoke-sub-' || v_suffix || '-a',
      'hardening-smoke-user-' || v_suffix,
      'hardening-smoke-course-' || v_suffix,
      v_status
    );

    BEGIN
      INSERT INTO public.course_subscriptions (id, user_id, course_id, status)
      VALUES (
        'hardening-smoke-sub-' || v_suffix || '-b',
        'hardening-smoke-user-' || v_suffix,
        'hardening-smoke-course-' || v_suffix,
        v_status
      );
      RAISE EXCEPTION 'Expected blocking subscription conflict for %', v_status;
    EXCEPTION
      WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.course_subscriptions (id, user_id, course_id, status)
  VALUES
    ('hardening-smoke-sub-canceled-a', 'hardening-smoke-canceled-user',
     'hardening-smoke-canceled-course', 'canceled'),
    ('hardening-smoke-sub-canceled-b', 'hardening-smoke-canceled-user',
     'hardening-smoke-canceled-course', 'canceled');
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.course_lesson_progress') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = 'public.course_lesson_progress'::regclass
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 2
        AND pg_get_indexdef(i.indexrelid, 1, true) = 'enrollment_id'
        AND pg_get_indexdef(i.indexrelid, 2, true) = 'lesson_id'
    ) THEN
      RAISE EXCEPTION
        'SMOKE_ASSERTION_FAILED: course_lesson_progress(enrollment_id, lesson_id) must be unique';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  DELETE FROM public.course_lesson_content
  WHERE lesson_id = 'hardening-smoke-owned-lesson';

  INSERT INTO public.course_lesson_content (
    lesson_id, course_id, content_text, created_at, updated_at
  ) VALUES (
    'hardening-smoke-owned-lesson',
    'hardening-smoke-course-a',
    'original',
    now(),
    now()
  );

  BEGIN
    INSERT INTO public.course_lesson_content (
      lesson_id, course_id, content_text, created_at, updated_at
    ) VALUES (
      'hardening-smoke-owned-lesson',
      'hardening-smoke-course-b',
      'attacker overwrite',
      now(),
      now()
    )
    ON CONFLICT (lesson_id) DO UPDATE SET
      course_id = excluded.course_id,
      content_text = excluded.content_text,
      updated_at = now();

    RAISE EXCEPTION 'Expected lesson ownership conflict';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM NOT LIKE 'LESSON_ID_OWNERSHIP_CONFLICT:%' THEN
        RAISE;
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.course_lesson_content
    WHERE lesson_id = 'hardening-smoke-owned-lesson'
      AND course_id = 'hardening-smoke-course-a'
      AND content_text = 'original'
  ) THEN
    RAISE EXCEPTION 'Cross-course lesson overwrite changed the original row';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  DELETE FROM public.product_offers
  WHERE id IN ('hardening-smoke-offer', 'hardening-smoke-rollback-offer');
  DELETE FROM public.courses
  WHERE id = 'hardening-smoke-offer-course';
  INSERT INTO public.courses (id, owner_id)
  VALUES ('hardening-smoke-offer-course', 'hardening-smoke-owner');

  v_result := public.create_product_offer_atomic(
    'hardening-smoke-offer-course',
    'hardening-smoke-owner',
    'hardening-smoke-offer',
    'hardening-smoke-price',
    'Professional access',
    4900,
    'USD',
    'one_time',
    true,
    'HARDENING-SMOKE'
  );

  IF v_result->>'offerId' <> 'hardening-smoke-offer'
     OR v_result->>'priceId' <> 'hardening-smoke-price' THEN
    RAISE EXCEPTION 'Atomic offer RPC returned an incompatible payload: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.product_offers o
    JOIN public.product_prices p ON p.offer_id = o.id
    WHERE o.id = 'hardening-smoke-offer'
      AND p.id = 'hardening-smoke-price'
      AND o.is_default = true
  ) THEN
    RAISE EXCEPTION 'Atomic offer RPC did not create offer, price, and default together';
  END IF;

  BEGIN
    PERFORM public.create_product_offer_atomic(
      'hardening-smoke-offer-course',
      'hardening-smoke-owner',
      'hardening-smoke-rollback-offer',
      'hardening-smoke-price',
      'Must roll back',
      5900,
      'USD',
      'one_time',
      false,
      NULL
    );
    RAISE EXCEPTION 'Expected duplicate price id failure';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.product_offers
    WHERE id = 'hardening-smoke-rollback-offer'
  ) THEN
    RAISE EXCEPTION 'Atomic offer RPC left a partial offer after price failure';
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

ROLLBACK;

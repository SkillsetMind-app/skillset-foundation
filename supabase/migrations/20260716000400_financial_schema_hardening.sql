BEGIN;

-- Payout data is readable only by its recipient and writable only by server code.
ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payout_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payout_ledger TO authenticated;
GRANT ALL ON TABLE public.payout_ledger TO service_role;

DROP POLICY IF EXISTS payout_ledger_teacher_read ON public.payout_ledger;
CREATE POLICY payout_ledger_teacher_read
  ON public.payout_ledger
  FOR SELECT
  TO authenticated
  USING (teacher_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS payout_ledger_service_write ON public.payout_ledger;
CREATE POLICY payout_ledger_service_write
  ON public.payout_ledger
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- These tables back SECURITY DEFINER helpers and are never client-writeable.
ALTER TABLE public.checkout_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_locks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_locks TO service_role;
GRANT ALL ON TABLE public.rate_limits TO service_role;

DROP POLICY IF EXISTS checkout_locks_service_access ON public.checkout_locks;
CREATE POLICY checkout_locks_service_access
  ON public.checkout_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS rate_limits_service_access ON public.rate_limits;
CREATE POLICY rate_limits_service_access
  ON public.rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON FUNCTION public.enforce_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(text, integer, integer)
  TO service_role;

-- Keep the existing PostgREST signature, but trust only server time and a
-- service-role caller that derived p_user_id from the authenticated request.
CREATE OR REPLACE FUNCTION public.claim_checkout_lock(
  p_user_id text,
  p_course_id text,
  p_order_id text,
  p_now text,
  p_session_ttl_ms integer,
  p_claim_grace_ms integer
) RETURNS TABLE(action text, checkout_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_key text;
  v_ttl interval;
  v_grace interval;
  v_lock public.checkout_locks%ROWTYPE;
  v_inserted integer;
BEGIN
  IF btrim(coalesce(p_user_id, '')) = ''
     OR char_length(p_user_id) > 220
     OR btrim(coalesce(p_course_id, '')) = ''
     OR char_length(p_course_id) > 220
     OR btrim(coalesce(p_order_id, '')) = ''
     OR char_length(p_order_id) > 220 THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_LOCK_IDENTITY';
  END IF;

  v_key := p_user_id || '__' || p_course_id;
  v_ttl := make_interval(
    secs => least(greatest(coalesce(p_session_ttl_ms, 0), 1000), 86400000) / 1000.0
  );
  v_grace := make_interval(
    secs => least(greatest(coalesce(p_claim_grace_ms, 0), 0), 86400000) / 1000.0
  );

  DELETE FROM public.checkout_locks
  WHERE expires_at < v_now;

  INSERT INTO public.checkout_locks (
    lock_key,
    user_id,
    course_id,
    order_id,
    checkout_url,
    checkout_session_id,
    claimed_at,
    expires_at,
    updated_at
  ) VALUES (
    v_key,
    p_user_id,
    p_course_id,
    p_order_id,
    NULL,
    NULL,
    v_now,
    v_now + v_ttl,
    v_now
  )
  ON CONFLICT (lock_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    action := 'claim';
    checkout_url := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_lock
  FROM public.checkout_locks
  WHERE lock_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_LOCK_NOT_FOUND';
  END IF;

  IF v_lock.checkout_url IS NOT NULL AND v_lock.expires_at > v_now THEN
    action := 'reuse';
    checkout_url := v_lock.checkout_url;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lock.claimed_at + v_grace > v_now AND v_lock.checkout_url IS NULL THEN
    action := 'wait';
    checkout_url := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.checkout_locks
  SET order_id = p_order_id,
      checkout_url = NULL,
      checkout_session_id = NULL,
      claimed_at = v_now,
      expires_at = v_now + v_ttl,
      updated_at = v_now
  WHERE lock_key = v_key;

  action := 'claim';
  checkout_url := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_lock(
  text, text, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_lock(
  text, text, text, text, integer, integer
) TO service_role;

-- Reserve a cumulative transfer-reversal target while holding the ledger row.
-- transfer_reversed_amount_minor is the reserved total (pending + completed),
-- so concurrent 30/60 claims reserve 30 + 30 rather than 30 + 60.
CREATE OR REPLACE FUNCTION public.claim_payout_transfer_reversal(
  p_ledger_id text,
  p_claim_key text,
  p_target_amount_minor numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger public.payout_ledger%ROWTYPE;
  v_claims jsonb;
  v_existing jsonb;
  v_current numeric;
  v_target numeric;
  v_planned numeric;
  v_state text;
  v_claim jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF btrim(coalesce(p_ledger_id, '')) = ''
     OR char_length(p_ledger_id) > 220 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_LEDGER_ID';
  END IF;
  IF btrim(coalesce(p_claim_key, '')) = ''
     OR char_length(p_claim_key) > 240 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_CLAIM_KEY';
  END IF;
  IF p_target_amount_minor IS NULL
     OR p_target_amount_minor < 0
     OR trunc(p_target_amount_minor) <> p_target_amount_minor THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_TARGET';
  END IF;

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = p_ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_NOT_FOUND';
  END IF;
  IF v_ledger.transfer_amount_minor IS NULL
     OR v_ledger.transfer_amount_minor < 0 THEN
    RAISE EXCEPTION 'PAYOUT_TRANSFER_NOT_RELEASED';
  END IF;

  v_claims := CASE
    WHEN jsonb_typeof(v_ledger.refund_reversal_claims) = 'object'
      THEN v_ledger.refund_reversal_claims
    ELSE '{}'::jsonb
  END;
  v_existing := v_claims -> p_claim_key;

  IF v_existing IS NOT NULL THEN
    IF jsonb_typeof(v_existing) <> 'object'
       OR jsonb_typeof(v_existing->'plannedAmountMinor') <> 'number' THEN
      RAISE EXCEPTION 'CORRUPT_PAYOUT_REVERSAL_CLAIM';
    END IF;

    RETURN v_existing || jsonb_build_object(
      'claimKey', p_claim_key,
      'action', CASE
        WHEN coalesce(v_existing->>'state', '') = 'pending'
             AND (v_existing->>'plannedAmountMinor')::numeric > 0
          THEN 'execute'
        ELSE 'skip'
      END,
      'planned_amount_minor',
        (v_existing->>'plannedAmountMinor')::numeric,
      'redelivery', true,
      'shouldExecute',
        coalesce(v_existing->>'state', '') = 'pending'
        AND (v_existing->>'plannedAmountMinor')::numeric > 0
    );
  END IF;

  v_current := greatest(
    coalesce(v_ledger.transfer_reversed_amount_minor, 0),
    0
  );
  v_target := least(p_target_amount_minor, v_ledger.transfer_amount_minor);
  v_planned := greatest(v_target - v_current, 0);
  v_state := CASE WHEN v_planned > 0 THEN 'pending' ELSE 'done' END;
  v_claim := jsonb_build_object(
    'claimKey', p_claim_key,
    'state', v_state,
    'plannedAmountMinor', v_planned,
    'targetAmountMinor', v_target,
    'claimedAt', v_now
  );

  UPDATE public.payout_ledger
  SET transfer_reversed_amount_minor = v_current + v_planned,
      refund_reversal_claims = jsonb_set(
        v_claims,
        ARRAY[p_claim_key],
        v_claim,
        true
      ),
      updated_at = v_now
  WHERE id = p_ledger_id;

  RETURN v_claim || jsonb_build_object(
    'action', CASE WHEN v_planned > 0 THEN 'execute' ELSE 'skip' END,
    'planned_amount_minor', v_planned,
    'redelivery', false,
    'shouldExecute', v_planned > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_payout_transfer_reversal(
  p_ledger_id text,
  p_claim_key text,
  p_reversal_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger public.payout_ledger%ROWTYPE;
  v_claims jsonb;
  v_claim jsonb;
  v_planned numeric;
  v_reversal_id text := nullif(btrim(coalesce(p_reversal_id, '')), '');
  v_now timestamptz := clock_timestamp();
BEGIN
  IF btrim(coalesce(p_ledger_id, '')) = ''
     OR btrim(coalesce(p_claim_key, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_COMPLETION';
  END IF;

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = p_ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_NOT_FOUND';
  END IF;

  v_claims := CASE
    WHEN jsonb_typeof(v_ledger.refund_reversal_claims) = 'object'
      THEN v_ledger.refund_reversal_claims
    ELSE '{}'::jsonb
  END;
  v_claim := v_claims -> p_claim_key;

  IF v_claim IS NULL
     OR jsonb_typeof(v_claim) <> 'object'
     OR jsonb_typeof(v_claim->'plannedAmountMinor') <> 'number' THEN
    RAISE EXCEPTION 'PAYOUT_REVERSAL_CLAIM_NOT_FOUND';
  END IF;

  v_planned := (v_claim->>'plannedAmountMinor')::numeric;
  IF v_claim->>'state' = 'done' THEN
    IF nullif(v_claim->>'reversalId', '') IS NOT NULL
       AND v_reversal_id IS DISTINCT FROM nullif(v_claim->>'reversalId', '') THEN
      RAISE EXCEPTION 'PAYOUT_REVERSAL_COMPLETION_CONFLICT';
    END IF;
    RETURN v_claim || jsonb_build_object(
      'claimKey', p_claim_key,
      'redelivery', true,
      'shouldExecute', false
    );
  END IF;

  IF v_planned > 0 AND v_reversal_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_REVERSAL_ID_REQUIRED';
  END IF;

  v_claim := v_claim || jsonb_build_object(
    'state', 'done',
    'reversalId', v_reversal_id,
    'completedAt', v_now
  );

  UPDATE public.payout_ledger
  SET refund_reversal_claims = jsonb_set(
        v_claims,
        ARRAY[p_claim_key],
        v_claim,
        true
      ),
      latest_transfer_reversal_id = coalesce(
        v_reversal_id,
        latest_transfer_reversal_id
      ),
      latest_transfer_reversal_at = CASE
        WHEN v_reversal_id IS NOT NULL THEN v_now
        ELSE latest_transfer_reversal_at
      END,
      updated_at = v_now
  WHERE id = p_ledger_id;

  RETURN v_claim || jsonb_build_object(
    'claimKey', p_claim_key,
    'redelivery', false,
    'shouldExecute', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payout_transfer_reversal(
  text, text, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_payout_transfer_reversal(
  text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_transfer_reversal(
  text, text, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_payout_transfer_reversal(
  text, text, text
) TO service_role;

-- Remove only duplicates whose surviving row is unambiguous, then add the
-- unique indexes required by ON CONFLICT throughout the application RPCs.
WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY stripe_event_id
           ORDER BY processed_at DESC NULLS LAST,
                    claimed_at DESC NULLS LAST,
                    ctid DESC
         ) AS position
  FROM public.processed_stripe_events
  WHERE stripe_event_id IS NOT NULL
)
DELETE FROM public.processed_stripe_events target
USING ranked
WHERE target.ctid = ranked.ctid
  AND ranked.position > 1;

WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY title_key
           ORDER BY ctid DESC
         ) AS position
  FROM public.course_title_keys
  WHERE title_key IS NOT NULL
)
DELETE FROM public.course_title_keys target
USING ranked
WHERE target.ctid = ranked.ctid
  AND ranked.position > 1;

DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM (
    SELECT lesson_id
    FROM public.course_lesson_content
    WHERE lesson_id IS NOT NULL
    GROUP BY lesson_id
    HAVING count(DISTINCT course_id)
      + CASE WHEN bool_or(course_id IS NULL) THEN 1 ELSE 0 END > 1
  ) conflicts;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'COURSE_LESSON_CONTENT_OWNERSHIP_CONFLICT: % lesson ids exist in multiple courses',
      v_conflicts
      USING HINT = 'Resolve the conflicting lesson ids before reapplying this migration.';
  END IF;
END;
$$;

WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY lesson_id
           ORDER BY updated_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    ctid DESC
         ) AS position
  FROM public.course_lesson_content
  WHERE lesson_id IS NOT NULL
)
DELETE FROM public.course_lesson_content target
USING ranked
WHERE target.ctid = ranked.ctid
  AND ranked.position > 1;

WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY enrollment_id, lesson_id
           ORDER BY completed_at DESC NULLS LAST,
                    ctid DESC
         ) AS position
  FROM public.lesson_progress
  WHERE enrollment_id IS NOT NULL
    AND lesson_id IS NOT NULL
)
DELETE FROM public.lesson_progress target
USING ranked
WHERE target.ctid = ranked.ctid
  AND ranked.position > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.processed_stripe_events'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'stripe_event_id'
  ) THEN
    CREATE UNIQUE INDEX processed_stripe_events_stripe_event_id_uniq
      ON public.processed_stripe_events (stripe_event_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.course_title_keys'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'title_key'
  ) THEN
    CREATE UNIQUE INDEX course_title_keys_title_key_uniq
      ON public.course_title_keys (title_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.course_lesson_content'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'lesson_id'
  ) THEN
    CREATE UNIQUE INDEX course_lesson_content_lesson_id_uniq
      ON public.course_lesson_content (lesson_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.lesson_progress'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 2
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'enrollment_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'lesson_id'
  ) THEN
    CREATE UNIQUE INDEX lesson_progress_enrollment_lesson_uniq
      ON public.lesson_progress (enrollment_id, lesson_id);
  END IF;
END;
$$;

-- Some older environments used this longer table name. Harden it if present,
-- while keeping lesson_progress as the canonical table used by current RPCs.
DO $$
BEGIN
  IF to_regclass('public.course_lesson_progress') IS NOT NULL THEN
    EXECUTE $sql$
      WITH ranked AS (
        SELECT ctid,
               row_number() OVER (
                 PARTITION BY enrollment_id, lesson_id
                 ORDER BY completed_at DESC NULLS LAST, ctid DESC
               ) AS position
        FROM public.course_lesson_progress
        WHERE enrollment_id IS NOT NULL
          AND lesson_id IS NOT NULL
      )
      DELETE FROM public.course_lesson_progress target
      USING ranked
      WHERE target.ctid = ranked.ctid
        AND ranked.position > 1
    $sql$;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = to_regclass('public.course_lesson_progress')
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 2
        AND pg_get_indexdef(i.indexrelid, 1, true) = 'enrollment_id'
        AND pg_get_indexdef(i.indexrelid, 2, true) = 'lesson_id'
    ) THEN
      CREATE UNIQUE INDEX course_lesson_progress_enrollment_lesson_uniq
        ON public.course_lesson_progress (enrollment_id, lesson_id);
    END IF;
  END IF;
END;
$$;

-- Never guess which live Stripe subscription to delete. Existing duplicate
-- blocking rows require an explicit reconciliation before this invariant lands.
DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM (
    SELECT user_id, course_id
    FROM public.course_subscriptions
    WHERE user_id IS NOT NULL
      AND course_id IS NOT NULL
      AND status IN (
        'active',
        'trialing',
        'past_due',
        'unpaid',
        'incomplete',
        'paused'
      )
    GROUP BY user_id, course_id
    HAVING count(*) > 1
  ) conflicts;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'COURSE_SUBSCRIPTION_BLOCKING_CONFLICT: % user/course pairs have multiple blocking subscriptions',
      v_conflicts
      USING HINT =
        'Reconcile or cancel duplicate Stripe subscriptions before reapplying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS course_subscriptions_user_course_blocking_uniq
  ON public.course_subscriptions (user_id, course_id)
  WHERE status IN (
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused'
  );

-- Lesson ids are global identifiers. The teacher builder may update content in
-- its course, but its ON CONFLICT path may never reassign an existing id.
CREATE OR REPLACE FUNCTION public.prevent_course_lesson_content_course_move()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    RAISE EXCEPTION
      'LESSON_ID_OWNERSHIP_CONFLICT: lesson % belongs to course %',
      OLD.lesson_id,
      OLD.course_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_course_lesson_content_course_move
  ON public.course_lesson_content;
CREATE TRIGGER prevent_course_lesson_content_course_move
  BEFORE UPDATE OF course_id ON public.course_lesson_content
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_course_lesson_content_course_move();

-- One RPC transaction owns offer + price creation and optional default sync.
-- Parameter names map directly to POST /api/teach/offers fields and generated ids.
CREATE OR REPLACE FUNCTION public.create_product_offer_atomic(
  p_course_id text,
  p_owner_id text,
  p_offer_id text,
  p_price_id text,
  p_name text,
  p_amount_minor numeric,
  p_currency text,
  p_payment_type text,
  p_is_default boolean,
  p_public_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_course_owner text;
  v_name text := btrim(coalesce(p_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_payment_type text := btrim(coalesce(p_payment_type, ''));
  v_is_default boolean := coalesce(p_is_default, false);
  v_public_code text := nullif(upper(btrim(coalesce(p_public_code, ''))), '');
BEGIN
  IF btrim(coalesce(p_course_id, '')) = ''
     OR btrim(coalesce(p_owner_id, '')) = ''
     OR btrim(coalesce(p_offer_id, '')) = ''
     OR btrim(coalesce(p_price_id, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_IDENTITY';
  END IF;
  IF v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_NAME';
  END IF;
  IF p_amount_minor IS NULL
     OR p_amount_minor < 0
     OR trunc(p_amount_minor) <> p_amount_minor THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_AMOUNT';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_CURRENCY';
  END IF;
  IF v_payment_type NOT IN (
    'one_time',
    'subscription_monthly',
    'subscription_yearly',
    'free'
  ) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PAYMENT_TYPE';
  END IF;
  IF (v_payment_type = 'free' AND p_amount_minor <> 0)
     OR (v_payment_type <> 'free' AND p_amount_minor <= 0) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PRICE';
  END IF;
  IF v_payment_type = 'free' AND NOT v_is_default THEN
    RAISE EXCEPTION 'FREE_PRODUCT_OFFER_MUST_BE_DEFAULT';
  END IF;
  IF v_public_code IS NOT NULL
     AND (
       char_length(v_public_code) > 24
       OR v_public_code !~ '^[A-Z0-9-]+$'
     ) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PUBLIC_CODE';
  END IF;

  SELECT owner_id INTO v_course_owner
  FROM public.courses
  WHERE id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COURSE_NOT_FOUND';
  END IF;
  IF v_course_owner IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'PRODUCT_OFFER_OWNER_MISMATCH';
  END IF;

  INSERT INTO public.product_offers (
    id,
    course_id,
    name,
    is_default,
    active,
    public_code,
    created_at,
    updated_at
  ) VALUES (
    p_offer_id,
    p_course_id,
    v_name,
    false,
    true,
    v_public_code,
    now(),
    now()
  );

  INSERT INTO public.product_prices (
    id,
    offer_id,
    amount_minor,
    currency,
    payment_type,
    stripe_price_id,
    active,
    created_at,
    updated_at
  ) VALUES (
    p_price_id,
    p_offer_id,
    p_amount_minor,
    v_currency,
    v_payment_type,
    NULL,
    true,
    now(),
    now()
  );

  IF v_is_default THEN
    PERFORM public.set_default_product_offer(p_course_id, p_offer_id);
  END IF;

  RETURN jsonb_build_object(
    'offerId', p_offer_id,
    'priceId', p_price_id,
    'name', v_name,
    'amountMinor', p_amount_minor,
    'currency', v_currency,
    'paymentType', v_payment_type,
    'isDefault', v_is_default,
    'publicCode', v_public_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_offer_atomic(
  text, text, text, text, text, numeric, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_offer_atomic(
  text, text, text, text, text, numeric, text, text, boolean, text
) TO service_role;

COMMIT;

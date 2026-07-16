BEGIN;

-- Reconcile the generated live shape with the checkout-lock RPC shape.
ALTER TABLE public.checkout_locks
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_session_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'checkout_locks'
      AND column_name = 'acquired_at'
  ) THEN
    EXECUTE $sql$
      UPDATE public.checkout_locks
      SET claimed_at = COALESCE(claimed_at, acquired_at::timestamptz, now())
      WHERE claimed_at IS NULL
    $sql$;
  ELSE
    UPDATE public.checkout_locks
    SET claimed_at = now()
    WHERE claimed_at IS NULL;
  END IF;
END;
$$;

ALTER TABLE public.checkout_locks
  ALTER COLUMN claimed_at SET DEFAULT now(),
  ALTER COLUMN claimed_at SET NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS offer_id text,
  ADD COLUMN IF NOT EXISTS price_id text,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_minor numeric NOT NULL DEFAULT 0
    CHECK (discount_minor >= 0);

ALTER TABLE public.course_subscriptions
  ADD COLUMN IF NOT EXISTS offer_id text,
  ADD COLUMN IF NOT EXISTS price_id text,
  ADD COLUMN IF NOT EXISTS price_amount_minor numeric,
  ADD COLUMN IF NOT EXISTS currency text;

-- Keep one deterministic default while preserving every configured offer.
WITH ranked_defaults AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY course_id
           ORDER BY updated_at DESC, created_at DESC, id
         ) AS position
  FROM public.product_offers
  WHERE is_default = true AND active = true
)
UPDATE public.product_offers AS offers
SET is_default = false,
    updated_at = now()
FROM ranked_defaults
WHERE offers.id = ranked_defaults.id
  AND ranked_defaults.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS product_offers_one_active_default_uniq
  ON public.product_offers (course_id)
  WHERE is_default = true AND active = true;

CREATE OR REPLACE FUNCTION public.set_default_product_offer(
  p_course_id text,
  p_offer_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price public.product_prices%ROWTYPE;
BEGIN
  SELECT prices.* INTO v_price
  FROM public.product_prices AS prices
  JOIN public.product_offers AS offers ON offers.id = prices.offer_id
  WHERE offers.id = p_offer_id
    AND offers.course_id = p_course_id
    AND offers.active = true
    AND prices.active = true
  ORDER BY prices.created_at, prices.id
  LIMIT 1
  FOR UPDATE OF offers, prices;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer or active price not found.';
  END IF;

  UPDATE public.product_offers
  SET is_default = false,
      updated_at = now()
  WHERE course_id = p_course_id
    AND id <> p_offer_id;

  UPDATE public.product_offers
  SET is_default = true,
      updated_at = now()
  WHERE id = p_offer_id
    AND course_id = p_course_id;

  UPDATE public.courses
  SET price_amount_minor = v_price.amount_minor,
      currency = upper(v_price.currency),
      payment_type = v_price.payment_type,
      updated_at = now()
  WHERE id = p_course_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_product_offer(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_product_offer(text, text)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.course_coupon_reservations (
  order_id text PRIMARY KEY,
  coupon_id uuid NOT NULL REFERENCES public.course_coupons(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'redeemed', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_coupon_reservations_active_idx
  ON public.course_coupon_reservations (coupon_id, expires_at)
  WHERE status = 'reserved';

ALTER TABLE public.course_coupon_reservations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reserve_course_coupon(
  p_coupon_id uuid,
  p_order_id text,
  p_user_id text,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
  v_reserved_count integer;
  v_existing public.course_coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon
  FROM public.course_coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND OR v_coupon.active = false THEN
    RAISE EXCEPTION 'COUPON_UNAVAILABLE';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now() THEN
    RAISE EXCEPTION 'COUPON_EXPIRED';
  END IF;

  SELECT * INTO v_existing
  FROM public.course_coupon_reservations
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.coupon_id = p_coupon_id
       AND v_existing.user_id = p_user_id
       AND v_existing.status IN ('reserved', 'redeemed') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'COUPON_RESERVATION_CONFLICT';
  END IF;

  SELECT count(*)::integer INTO v_reserved_count
  FROM public.course_coupon_reservations
  WHERE coupon_id = p_coupon_id
    AND status = 'reserved';

  IF v_coupon.redeemed_count + v_reserved_count >= v_coupon.max_redemptions THEN
    RAISE EXCEPTION 'COUPON_LIMIT_REACHED';
  END IF;

  INSERT INTO public.course_coupon_reservations (
    order_id, coupon_id, user_id, status, expires_at
  ) VALUES (
    p_order_id, p_coupon_id, p_user_id, 'reserved', p_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_course_coupon_reservation(
  p_order_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.course_coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation
  FROM public.course_coupon_reservations
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_reservation.status = 'redeemed' THEN
    RETURN;
  END IF;
  IF v_reservation.status <> 'reserved' THEN
    RAISE EXCEPTION 'COUPON_RESERVATION_RELEASED';
  END IF;

  PERFORM 1
  FROM public.course_coupons
  WHERE id = v_reservation.coupon_id
  FOR UPDATE;

  UPDATE public.course_coupons
  SET redeemed_count = redeemed_count + 1,
      updated_at = now()
  WHERE id = v_reservation.coupon_id;

  UPDATE public.course_coupon_reservations
  SET status = 'redeemed',
      updated_at = now()
  WHERE order_id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_course_coupon_reservation(
  p_order_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.course_coupon_reservations
  SET status = 'released',
      updated_at = now()
  WHERE order_id = p_order_id
    AND status = 'reserved';
$$;

CREATE OR REPLACE FUNCTION public.delete_course_coupon(
  p_coupon_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon
  FROM public.course_coupons
  WHERE id = p_coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found.';
  END IF;

  PERFORM public.assert_course_owner(v_coupon.course_id);

  IF v_coupon.redeemed_count > 0 OR EXISTS (
    SELECT 1
    FROM public.course_coupon_reservations
    WHERE coupon_id = p_coupon_id
  ) THEN
    UPDATE public.course_coupons
    SET active = false,
        updated_at = now()
    WHERE id = p_coupon_id;
    RETURN jsonb_build_object('success', true, 'archived', true);
  END IF;

  DELETE FROM public.course_coupons WHERE id = p_coupon_id;
  RETURN jsonb_build_object('success', true, 'archived', false);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_course_coupon(uuid, text, text, timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_course_coupon_reservation(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_course_coupon_reservation(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_course_coupon(uuid, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_course_coupon_reservation(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_course_coupon_reservation(text)
  TO service_role;

-- Professional admission is a real soft gate: creators can build while review
-- is pending, but only an approved course can become publicly sellable.
INSERT INTO public.platform_settings (key, value)
VALUES ('require_creator_verification', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

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
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now::timestamptz, now());
  v_key text := p_user_id || '__' || p_course_id;
  v_ttl interval := make_interval(secs => GREATEST(p_session_ttl_ms, 1000) / 1000.0);
  v_grace interval := make_interval(secs => GREATEST(p_claim_grace_ms, 0) / 1000.0);
  v_lock public.checkout_locks%ROWTYPE;
BEGIN
  DELETE FROM public.checkout_locks WHERE expires_at < v_now;

  SELECT * INTO v_lock
  FROM public.checkout_locks
  WHERE lock_key = v_key
  FOR UPDATE;

  IF FOUND THEN
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
  ELSE
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
    );
  END IF;

  action := 'claim';
  checkout_url := NULL;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_checkout_lock(
  text, text, text, text, integer, integer
) TO authenticated, service_role;

COMMIT;

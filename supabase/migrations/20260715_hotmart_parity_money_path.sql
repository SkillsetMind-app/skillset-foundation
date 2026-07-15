-- Hotmart-parity money-path foundations (code-only slice)
-- 1) product_offers + product_prices (multi-price without removing legacy course columns)
-- 2) Critical RPCs used by checkout: claim_checkout_lock, enforce_rate_limit
-- 3) rate_limits table for enforce_rate_limit
-- Safe: additive IF NOT EXISTS / OR REPLACE. No DROP of money tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- Offers / prices (dual-read with courses.price_amount_minor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_offers (
  id text PRIMARY KEY,
  course_id text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  public_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_offers_course_idx
  ON public.product_offers (course_id, is_default DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS product_offers_public_code_uniq
  ON public.product_offers (lower(public_code))
  WHERE public_code IS NOT NULL AND public_code <> '';

CREATE TABLE IF NOT EXISTS public.product_prices (
  id text PRIMARY KEY,
  offer_id text NOT NULL REFERENCES public.product_offers(id) ON DELETE CASCADE,
  amount_minor numeric NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_type text NOT NULL DEFAULT 'one_time'
    CHECK (payment_type IN ('one_time','subscription_monthly','subscription_yearly','free')),
  stripe_price_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_prices_offer_idx
  ON public.product_prices (offer_id, active DESC);

ALTER TABLE public.product_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;

-- Public read of active offers/prices (marketplace). Writes via service role / RPCs later.
DROP POLICY IF EXISTS product_offers_public_read ON public.product_offers;
CREATE POLICY product_offers_public_read ON public.product_offers
  FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS product_prices_public_read ON public.product_prices;
CREATE POLICY product_prices_public_read ON public.product_prices
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- ---------------------------------------------------------------------------
-- rate_limits (enforce_rate_limit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_row public.rate_limits%ROWTYPE;
  v_window interval := make_interval(secs => GREATEST(p_window_ms, 1000) / 1000.0);
BEGIN
  IF p_key IS NULL OR length(p_key) < 1 OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_ARGS';
  END IF;

  INSERT INTO public.rate_limits (key, count, window_started_at, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO v_row FROM public.rate_limits WHERE key = p_key FOR UPDATE;

  IF v_now - v_row.window_started_at > v_window THEN
    UPDATE public.rate_limits
    SET count = 1, window_started_at = v_now, updated_at = v_now
    WHERE key = p_key;
    RETURN;
  END IF;

  IF v_row.count >= p_limit THEN
    RAISE EXCEPTION 'RATE_LIMIT';
  END IF;

  UPDATE public.rate_limits
  SET count = count + 1, updated_at = v_now
  WHERE key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(text, integer, integer) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_checkout_lock (B3 double-click guard)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_locks (
  lock_key text PRIMARY KEY,
  user_id text NOT NULL,
  course_id text NOT NULL,
  order_id text,
  checkout_url text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_locks_user_course_idx
  ON public.checkout_locks (user_id, course_id);

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

  SELECT * INTO v_lock FROM public.checkout_locks WHERE lock_key = v_key FOR UPDATE;

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
        claimed_at = v_now,
        expires_at = v_now + v_ttl,
        updated_at = v_now
    WHERE lock_key = v_key;
  ELSE
    INSERT INTO public.checkout_locks (
      lock_key, user_id, course_id, order_id, checkout_url, claimed_at, expires_at, updated_at
    ) VALUES (
      v_key, p_user_id, p_course_id, p_order_id, NULL, v_now, v_now + v_ttl, v_now
    );
  END IF;

  action := 'claim';
  checkout_url := NULL;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_checkout_lock(text, text, text, text, integer, integer)
  TO authenticated, service_role;

COMMIT;

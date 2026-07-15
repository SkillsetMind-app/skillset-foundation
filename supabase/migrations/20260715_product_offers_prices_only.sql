-- Additive only: multi-price offers tables for dual-read checkout.
-- Intentionally does NOT replace claim_checkout_lock / enforce_rate_limit —
-- those RPCs already exist on live with a different action contract ("proceed").

BEGIN;

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

DROP POLICY IF EXISTS product_offers_public_read ON public.product_offers;
CREATE POLICY product_offers_public_read ON public.product_offers
  FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS product_prices_public_read ON public.product_prices;
CREATE POLICY product_prices_public_read ON public.product_prices
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- Service role / authenticated writers (creator studio) can manage own rows later via RPC;
-- allow authenticated all for now is too open — service role bypasses RLS.

COMMIT;

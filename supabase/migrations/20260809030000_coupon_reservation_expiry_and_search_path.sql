-- Two fixes to the coupon reservation path.
--
-- 1) reserve_course_coupon counted EVERY row with status='reserved' against
--    max_redemptions, with no expiry filter. A reservation is only meant to
--    hold a slot until the Checkout session expires; once expired it must free
--    the slot again. Without the filter, abandoned checkouts permanently ate
--    the coupon: ten abandoned attempts killed a 10-use coupon that nobody
--    ever redeemed, and no amount of waiting recovered it. The partial index
--    course_coupon_reservations_active_idx (coupon_id, expires_at) WHERE
--    status = 'reserved' already exists and now actually gets used.
--
--    The webhook release path (checkout.session.expired /
--    async_payment_failed) still flips rows to 'released' where it can; this
--    is the belt to that suspenders, for the case where Stripe never delivers
--    the expiry event.
--
-- 2) SECURITY DEFINER functions pinned search_path = public without pg_temp.
--    Postgres searches pg_temp FIRST when it is not explicitly listed, so a
--    caller who can create temp objects could shadow an unqualified reference.
--    Every body here is schema-qualified today, so nothing is exploitable
--    right now — but that is a property of the current text, not of the
--    declaration. ALTER FUNCTION changes only the setting, never the body.

CREATE OR REPLACE FUNCTION public.reserve_course_coupon(
  p_coupon_id uuid,
  p_order_id text,
  p_user_id text,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Only reservations that are still live hold a slot.
  SELECT count(*)::integer INTO v_reserved_count
  FROM public.course_coupon_reservations
  WHERE coupon_id = p_coupon_id
    AND status = 'reserved'
    AND expires_at > now();

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

ALTER FUNCTION public.finalize_course_coupon_reservation(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.release_course_coupon_reservation(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_default_product_offer(text, text)
  SET search_path = public, pg_temp;

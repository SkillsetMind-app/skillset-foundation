BEGIN;

-- CREATE OR REPLACE preserves existing ACLs. Remove inherited client grants
-- from server-only checkout RPCs, then restore only the intended roles.
REVOKE ALL ON FUNCTION public.set_default_product_offer(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_product_offer(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.reserve_course_coupon(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_course_coupon_reservation(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_course_coupon_reservation(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_course_coupon(uuid, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_course_coupon_reservation(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_course_coupon_reservation(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_checkout_lock(
  text, text, text, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_checkout_lock(
  text, text, text, text, integer, integer
) TO authenticated, service_role;

COMMIT;

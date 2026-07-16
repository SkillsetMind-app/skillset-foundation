BEGIN;

-- Remove the stale overload left by the pre-cutover checkout implementation.
-- Keeping two functions with identical argument names makes PostgREST dispatch
-- ambiguous and leaves an obsolete lock algorithm reachable.
DROP FUNCTION IF EXISTS public.claim_checkout_lock(
  text, text, text, timestamptz, bigint, bigint
);

-- Preserve the current client signature, but trust server time and service-role
-- identity only. The insert-first path also makes first-claim acquisition atomic.
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

NOTIFY pgrst, 'reload schema';

COMMIT;

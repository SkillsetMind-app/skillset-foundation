-- Existing accounts must not receive a new first-run interruption. PostgreSQL
-- fills existing rows with this default; later signups start with NULL.
-- One statement stays atomic even when the caller uses psql autocommit.
DO $migration$
BEGIN
ALTER TABLE public.users ADD COLUMN welcome_tour_seen_at timestamptz DEFAULT now();
ALTER TABLE public.users ALTER COLUMN welcome_tour_seen_at DROP DEFAULT;

-- Presentation state only: never a substitute for onboarding, activation or
-- course access. Separate from preferences so settings saves cannot erase it.
CREATE FUNCTION public.claim_welcome_tour(p_uid text, p_surface text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claimed boolean := false;
BEGIN
  PERFORM public.require_strong_session();
  IF auth.uid() IS NULL OR p_uid IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'The current account is required.' USING ERRCODE = '42501';
  END IF;
  IF p_surface IS NULL OR p_surface NOT IN ('student', 'teacher') THEN
    RAISE EXCEPTION 'Unknown welcome surface.' USING ERRCODE = '22023';
  END IF;
  IF p_surface = 'teacher' AND public.creator_activation_blocked(p_uid) THEN
    RETURN false;
  END IF;

  -- One conditional UPDATE is the reservation: a concurrent caller rechecks
  -- the NULL condition after taking the row lock and cannot also win.
  UPDATE public.users SET welcome_tour_seen_at = now()
  WHERE uid = p_uid AND onboarding_completed AND welcome_tour_seen_at IS NULL
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END $$;
REVOKE ALL ON FUNCTION public.claim_welcome_tour(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_welcome_tour(text, text) TO authenticated;
END;
$migration$;

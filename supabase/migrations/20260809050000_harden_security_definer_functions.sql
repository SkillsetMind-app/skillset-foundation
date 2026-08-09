-- Two independent hardenings of SECURITY DEFINER functions. Already applied to
-- production on 2026-08-09; this file exists so a rebuilt environment lands in
-- the same state.
--
-- 1. search_path pinning. A SECURITY DEFINER function runs as its owner, so
--    whatever schemas its search_path names are searched with owner privileges.
--    Any role can create objects in pg_temp, so if pg_temp is not pinned LAST
--    (or absent, which lets Postgres put it first), a caller can plant a table
--    or function that shadows one the body meant to reach and have the owner
--    execute it. 55 of the 59 SECURITY DEFINER functions already pinned it;
--    these four did not. Written as a loop rather than four ALTERs so it stays
--    correct if a fifth appears — and so no signature has to be spelled out.

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
        WHERE c LIKE '%pg_temp%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.sig);
  END LOOP;
END $$;

-- 2. Take the advisor's vector search off the public API surface.
--    advisor_documents is RLS-on/deny-all, so the only way in was this
--    SECURITY DEFINER function — and it was granted to `authenticated`, which
--    publishes it on PostgREST. Any signed-in user could POST
--    /rest/v1/rpc/match_advisor_documents with match_threshold 0 and an
--    arbitrary match_count: a full pgvector scan per call, unthrottled, plus
--    the whole corpus back. /api/teach/advisor now runs the search on the
--    service-role client (see src/app/api/teach/advisor/route.ts), so nothing
--    legitimate needs this grant.
--
--    Note the asymmetry with get_my_subscriber_profiles, which KEEPS its
--    `authenticated` grant: that one is called straight from the browser
--    (src/lib/data/user-profiles.ts) and revoking it would break the page.

REVOKE EXECUTE ON FUNCTION public.match_advisor_documents(vector, double precision, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.match_advisor_documents(vector, double precision, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_advisor_documents(vector, double precision, integer) FROM PUBLIC;

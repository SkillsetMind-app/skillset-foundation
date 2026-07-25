-- Close two SECURITY DEFINER trigger functions that PUBLIC could call directly.
--
-- Both were created without an explicit grant, so their ACL was `=X/postgres`
-- (the leading `=` is PUBLIC). PostgREST exposes every EXECUTE-able public
-- function at /rest/v1/rpc/<name>, so `anon` — an unauthenticated visitor with
-- only the publishable key — could invoke them:
--
--   handle_new_user()                 SECURITY DEFINER, writes a profile row
--   notify_enrolled_on_course_event() SECURITY DEFINER, fans out notifications
--
-- Neither is meant to be called by anyone. Each exists solely as the body of a
-- trigger, and Postgres checks EXECUTE when the trigger is CREATED, not when it
-- fires — so revoking is invisible to the trigger and only closes the RPC door.
-- service_role keeps EXECUTE, which is what the server-side admin client uses.
--
-- APPLIED to project ijtikldtjvsbtwszokvs on 2026-07-25. Verified before:
-- acl `=X/postgres | postgres=X/postgres | service_role=X/postgres`, 1 trigger
-- each. Verified after: acl `postgres=X/postgres | service_role=X/postgres`,
-- 1 trigger each, still attached.
--
-- Idempotent: revoking a privilege that is already absent is a no-op.

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

revoke execute on function public.notify_enrolled_on_course_event()
  from public, anon, authenticated;

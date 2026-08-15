-- log_audit_event() is SECURITY DEFINER with no authorization check: every
-- argument, including p_actor_id and p_actor_email, is free text inserted
-- straight into audit_log. Granted to `authenticated`, any signed-in user could
-- POST /rest/v1/rpc/log_audit_event and forge entries attributed to an admin,
-- or flood the table. The function swallows every exception ("auditing is
-- best-effort"), so nothing surfaces when it is abused.
--
-- Nothing needs that grant. The only direct callers are the Stripe webhook's
-- admin (service_role) client; every other caller is a `perform` inside another
-- SECURITY DEFINER function, which runs as the function owner, not the caller.
revoke execute on function public.log_audit_event(text, text, text, text, text, text, jsonb)
  from authenticated;

-- Both are SECURITY INVOKER helpers, so an unpinned search_path is not a
-- privilege-escalation vector -- but it still lets a caller-controlled
-- search_path change which operators and functions resolve. One ALTER each
-- clears the remaining function_search_path_mutable advisories.
alter function public.featured_slots_for_plan(text)
  set search_path = 'public', 'pg_temp';
alter function public.public_storefront_projection(jsonb, text)
  set search_path = 'public', 'pg_temp';

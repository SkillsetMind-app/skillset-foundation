-- The role predicates were granted to anon along with authenticated. They return
-- false without a session, so nothing leaks — but a signed-out caller has no
-- reason to reach them at all, and the database linter flags every
-- anon-executable SECURITY DEFINER function for exactly that reason.
--
-- Verified before revoking: is_admin and is_teacher are called only from server
-- routes that already hold a session, never from a client component and never
-- anonymously. RLS policies that call these run as part of policy evaluation,
-- not through the REST grant, so they are unaffected.
--
-- verify_skillset_certificate deliberately KEEPS its anon grant: the public
-- certificate verification page is reachable without signing in, which is the
-- entire point of a verifiable credential.

revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_moderator() from anon;
revoke execute on function public.is_ops() from anon;
revoke execute on function public.is_support() from anon;
revoke execute on function public.is_teacher() from anon;
revoke execute on function public.is_target_author(text, text) from anon;

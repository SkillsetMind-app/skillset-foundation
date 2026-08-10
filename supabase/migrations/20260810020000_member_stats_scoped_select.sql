-- member_stats was readable by every authenticated user (`USING (true)`), which
-- let anyone with a free account dump the whole member roster: uid, display
-- name, points, level and likes for every user on the platform.
--
-- Two comments in the app asserted the opposite -- that RLS "deliberately
-- forbids list so the full member roster can never be enumerated". That was a
-- Firestore-era belief that did not survive the move to Postgres: Firestore
-- rules distinguish `get` from `list`, RLS does not. An unfiltered SELECT *is*
-- the list, and the policy allowed it.
--
-- The legitimate access set is the one the app actually reads: your own row,
-- plus the members whose badges appear next to posts and comments inside a
-- course you share with them. Scope the policy to exactly that. The read path
-- (src/lib/data/gamification.ts) fetches one uid at a time, so the extra EXISTS
-- costs a single indexed lookup per badge, and a bulk SELECT now returns only
-- the rows the caller was always entitled to see.

drop policy if exists member_stats_select_authenticated on public.member_stats;

create policy member_stats_select_authenticated on public.member_stats
  as permissive for select to authenticated
  using (
    uid = (select auth.uid())::text
    or exists (
      select 1
      from public.courses c
      where
        -- caller participates in the course, as owner or as a student
        (
          c.owner_id = (select auth.uid())::text
          or exists (
            select 1 from public.enrollments e
            where e.course_id = c.id
              and e.user_id = (select auth.uid())::text
          )
        )
        -- and so does the member whose stats are being read
        and (
          c.owner_id = member_stats.uid
          or exists (
            select 1 from public.enrollments e2
            where e2.course_id = c.id
              and e2.user_id = member_stats.uid
          )
        )
    )
  );

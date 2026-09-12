-- Presence carried member names and user IDs on a public Realtime channel.
-- Keep Postgres Changes unchanged; only this Presence topic is private.

drop policy if exists community_presence_read on realtime.messages;
create policy community_presence_read
on realtime.messages
for select
to authenticated
using (
  extension = 'presence'
  and (select realtime.topic()) like 'community-presence:%'
  and (select public.account_session_allowed())
  and (
    (select public.owns_course_reference(
      split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)
    ))
    or (select public.has_enrollment_for_course_slug(
      split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)
    ))
    or (select public.is_admin())
  )
);

drop policy if exists community_presence_write on realtime.messages;
create policy community_presence_write
on realtime.messages
for insert
to authenticated
with check (
  extension = 'presence'
  and (select realtime.topic()) like 'community-presence:%'
  and (select public.account_session_allowed())
  and (
    (select public.owns_course_reference(
      split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)
    ))
    or (select public.has_enrollment_for_course_slug(
      split_part(split_part((select realtime.topic()), 'community-presence:', 2), '#', 1)
    ))
    or (select public.is_admin())
  )
);

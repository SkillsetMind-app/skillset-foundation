\set ON_ERROR_STOP on

begin;

do $$
declare
  v_policy_count integer;
  v_bad_policy_count integer;
begin
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'realtime'
    and tablename = 'messages'
    and policyname in ('community_presence_read', 'community_presence_write');

  if v_policy_count <> 2 then
    raise exception 'COMMUNITY_PRESENCE_REGRESSION: private Realtime policies missing';
  end if;

  select count(*) into v_bad_policy_count
  from pg_policies
  where schemaname = 'realtime'
    and tablename = 'messages'
    and policyname in ('community_presence_read', 'community_presence_write')
    and (
      roles::text <> '{authenticated}'
      or cmd not in ('SELECT', 'INSERT')
      or coalesce(qual, with_check, '') not like '%community-presence:%'
      or coalesce(qual, with_check, '') not like '%account_session_allowed%'
      or coalesce(qual, with_check, '') not like '%owns_course_reference%'
      or coalesce(qual, with_check, '') not like '%has_enrollment_for_course_slug%'
      or coalesce(qual, with_check, '') not like '%is_admin%'
      or coalesce(qual, with_check, '') not like '%presence%'
    );

  if v_bad_policy_count <> 0 then
    raise exception 'COMMUNITY_PRESENCE_REGRESSION: private Realtime policy lost an authorization guard';
  end if;
end $$;

rollback;

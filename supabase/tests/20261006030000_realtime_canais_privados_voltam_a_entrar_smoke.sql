\set ON_ERROR_STOP on
-- Disposable database: the partition, the messages and the account control come back in the
-- rollback.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'REALTIME_JOIN_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
-- Who joins the channel: claims of a logged-in user and the channel topic, as
-- Realtime builds them before checking the read.
create function pg_temp.joins(n int, topic text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n),
    'role', 'authenticated', 'aal', 'aal1', 'session_id', pg_temp.uid(n + 100))::text, true);
  perform set_config('realtime.topic', topic, true);
end $$;

-- Realtime checks joining a private channel by writing a test message
-- through the extension and seeing whether RLS lets the joiner read it. Here it is the same, in a
-- partition of its own (the table is partitioned by inserted_at in production).
do $$
begin
  if (select relkind from pg_class where oid = 'realtime.messages'::regclass) = 'p' then
    execute $q$create table realtime.messages_smoke_join partition of realtime.messages
      for values from ('2000-01-01') to ('2000-01-02')$q$;
  end if;
end $$;

insert into realtime.messages (topic, extension, private, inserted_at, updated_at)
select topic, extension, true, '2000-01-01 12:00', '2000-01-01 12:00'
from (values ('courses:builder:smoke-course#13'), ('community-presence:smoke-course#2')) t(topic)
cross join (values ('broadcast'), ('presence')) e(extension);

-- Suspended account (uid 2). With no control row, the account is allowed.
insert into public.account_controls (uid, suspended, sessions_revoked_before)
values (pg_temp.uid(2)::text, true, now());

-- 1. Logged-in creator joins the builder channel (the autosave echo).
select pg_temp.joins(1, 'courses:builder:smoke-course#13');
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13' and extension = 'broadcast'),
  'authenticated user cannot join a Postgres Changes channel');
-- Joining does not become presence: no Postgres Changes topic has presence.
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13' and extension = 'presence'),
  'join policy opened presence on a Postgres Changes channel');
reset role;

-- 1b. Joining is not broadcasting: with no INSERT policy for broadcast, whoever is
-- logged in still cannot send a message in a Postgres Changes channel.
select pg_temp.joins(1, 'courses:builder:smoke-course#13');
set local role authenticated;
do $$
begin
  begin
    insert into realtime.messages (topic, extension, private, inserted_at, updated_at)
    values ('courses:builder:smoke-course#13', 'broadcast', true, '2000-01-01 12:00', '2000-01-01 12:00');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'REALTIME_JOIN_REGRESSION: authenticated user can broadcast on a Postgres Changes channel';
end $$;
reset role;

-- 1c. With no topic (realtime.topic empty), nothing is visible.
select pg_temp.joins(1, '');
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from realtime.messages),
  'messages visible with no realtime.topic set');
reset role;

-- 2. Community presence stays closed to whoever is not the owner, learner or
-- admin (#355): neither broadcast nor presence.
select pg_temp.joins(1, 'community-presence:smoke-course#2');
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'community-presence:smoke-course#2'),
  'outsider joined the community presence channel');
reset role;

-- 3. A suspended account does not join.
select pg_temp.joins(2, 'courses:builder:smoke-course#13');
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13'),
  'suspended account joined a Postgres Changes channel');
reset role;

-- 4. A visitor who is not logged in does not join.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('realtime.topic', 'courses:builder:smoke-course#13', true);
set local role anon;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13'),
  'anonymous visitor joined a Postgres Changes channel');
reset role;

rollback;

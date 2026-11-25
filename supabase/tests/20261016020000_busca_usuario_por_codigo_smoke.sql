\set ON_ERROR_STOP on
-- Disposable database. Fixtures undone in the final rollback.
-- The watermark code ("4F3A-92C1") finds the account in the Operations search,
-- and whoever is not an admin with 2FA is still blocked.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'USER_CODE_SEARCH_REGRESSION: %', message; end if; end $$;
-- Account 2 is the one in the example; the others do not share the first 8 characters.
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select (case n when 2 then '4f3a92c1-0000-4000-8000-000000000002'
    else '85000000-0000-4000-8000-' || lpad(n::text, 12, '0') end)::uuid;
$$;
create function pg_temp.actor(n int, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n), 'role', 'authenticated',
    'aal', aal, 'session_id', pg_temp.uid(n + 100)::text)::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
create function pg_temp.refused(statement text, expected text, state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = state and sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'USER_CODE_SEARCH_REGRESSION: %', 'refused call succeeded: ' || statement;
end $$;

-- Fixtures: 1 admin, 2 target (learner), 3 learner.
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'busca-codigo-' || n || '@example.test',
  now(), '{}', '{}', now(), now() from generate_series(1, 3) n;
insert into public.users(uid, email, roles, onboarding_completed)
select id::text, email, '["student"]'::jsonb, true from auth.users where email like 'busca-codigo-%@example.test'
on conflict (uid) do nothing;
update public.users set roles = '["admin"]' where uid = pg_temp.uid(1)::text;
insert into auth.sessions(id, user_id, created_at, updated_at)
select pg_temp.uid(n + 100), pg_temp.uid(n), now() - interval '1 hour', now() from generate_series(1, 3) n;

-- 1) A learner with 2FA does not use the search, not even with the code.
select pg_temp.actor(3);
set local role authenticated;
select pg_temp.refused($q$select * from public.admin_search_users('4F3A-92C1')$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
reset role;

-- 2) An admin without 2FA (aal1) does not either.
select pg_temp.actor(1, 'aal1');
set local role authenticated;
select pg_temp.refused($q$select * from public.admin_search_users('4F3A-92C1')$q$, 'OPS_ADMIN_MFA_REQUIRED', '42501');
reset role;

-- 3) An admin with 2FA finds the account by the code, with or without hyphen, in any case.
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.assert_true((select array_agg(uid) from public.admin_search_users('4F3A-92C1'))
  = array[pg_temp.uid(2)::text], 'code with hyphen');
select pg_temp.assert_true((select array_agg(uid) from public.admin_search_users(' 4f3a92c1 '))
  = array[pg_temp.uid(2)::text], 'code without hyphen');

-- 4) Only the whole code matches: a piece of a uid does not list accounts.
select pg_temp.assert_true((select count(*) from public.admin_search_users('4F3A-92C')) = 0, 'partial code');
select pg_temp.assert_true((select count(*) from public.admin_search_users('4F3A')) = 0, 'short prefix');

-- 5) The old search stays the same: whole uid and email.
select pg_temp.assert_true((select array_agg(uid) from public.admin_search_users(pg_temp.uid(2)::text))
  = array[pg_temp.uid(2)::text], 'full uid');
select pg_temp.assert_true((select count(*) from public.admin_search_users('busca-codigo-')) = 3, 'email search');
reset role;
rollback;

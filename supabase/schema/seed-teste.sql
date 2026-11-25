-- Fixtures mínimas para os smoke tests de RLS de supabase/tests/.
--
-- Why this file exists: the smoke tests were written against a live database
-- and read a REAL user and a REAL course (`select ... limit 1` + `\gset`).
-- On a freshly built database those tables are empty, the `\gset` aborts and the
-- test fails for lack of data, not because of a policy regression. These rows are
-- the minimum that makes the tests measure what they promise.
--
-- Who applies it: scripts/build-test-db.sh, at the end, after the baseline and the
-- migrations. It lives here and not in supabase/seed.sql on purpose: on the CLI's
-- default path it would be applied before any table exists, and it would fail. This
-- never runs against production: only on a throwaway database.

-- A single uuid, used as auth.users.id, public.users.uid and
-- enrollments.user_id — the tests derive one from the other and they must match.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'smoke@ci.local',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- The public.users row is NOT inserted here: the on_auth_user_created trigger
-- calls handle_new_user(), which already creates it with roles '["student"]' — the same
-- path as a real signup. Writing it from outside would be worse in two ways:
-- the users_field_guard_biu trigger refuses to touch server-controlled fields
-- (current_plan_id, Stripe, creator gate), and the seed would end up testing a
-- profile the application never produces.
--
-- roles without 'admin' and no row in custom_domains: it is exactly the profile
-- that 20260731000100 (creator gate) and 20260901220000 (domain quota)
-- catch with `limit 1`. current_plan_id is left null on purpose — the quota
-- test sets it by itself, with the trusted-write flag.
--
-- If this path breaks, the seed has to shout: without the row, the smoke tests
-- would fail for lack of data and the real reason would stay hidden.
do $$
begin
  if not exists (
    select 1 from public.users
    where uid = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception
      'seed: handle_new_user() nao criou public.users para o usuario de teste';
  end if;
end $$;

-- 20260902120000 (second factor) enrolls this user in this course to prove
-- that the policy disappears with the enrollment in a weak session.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
values ('smoke-ci-plan', '11111111-1111-4111-8111-111111111111', 'basic', 'active', now() + interval '1 day');

insert into public.courses (
  id,
  owner_id,
  slug,
  title,
  summary,
  category,
  status,
  currency,
  price_amount_minor
) values (
  'smoke-ci-course',
  '11111111-1111-4111-8111-111111111111',
  'smoke-ci-course',
  'Smoke CI',
  'Curso usado só pelos smoke tests de RLS.',
  'smoke',
  'published',
  'brl',
  0
) on conflict (id) do nothing;

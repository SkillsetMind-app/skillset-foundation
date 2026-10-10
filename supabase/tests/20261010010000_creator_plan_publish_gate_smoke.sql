\set ON_ERROR_STOP on
-- Disposable database only. All fixtures roll back.
begin;
create function pg_temp.check_plan(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'CREATOR_PLAN_REGRESSION: %', label; end if;
end $$;
create function pg_temp.uid(n int) returns text language sql immutable as $$
  select '86651010-0000-4000-8000-' || lpad(n::text, 12, '0');
$$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n)::uuid, 'authenticated', 'authenticated', 'plan-gate-' || n || '@example.test',
  now(), '{}', '{}', now(), now() from generate_series(1, 3) n;
update public.users set roles = '["teacher","student"]', onboarding_completed = true,
  teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke'
where uid = pg_temp.uid(1);
update public.users set roles = '["admin"]' where uid = pg_temp.uid(2);
insert into public.creator_activation_waivers(uid, granted_by, ready_at)
values (pg_temp.uid(1), pg_temp.uid(2), now());
insert into public.platform_settings(key, value) values ('require_activation_fee', 'false'),
  ('require_creator_verification', 'false') on conflict (key) do update set value = excluded.value;
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'activation waiver is not a plan');
select pg_temp.check_plan(not public.course_owner_can_sell('missing-user'), 'missing owner fails closed');
select pg_temp.check_plan(public.course_owner_can_sell(pg_temp.uid(2)), 'admin exemption');
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
values ('smoke-plan-gate', pg_temp.uid(1), 'basic', 'active', now() + interval '1 day');
select pg_temp.check_plan(public.course_owner_can_sell(pg_temp.uid(1)), 'active subscription');
update public.subscriptions set cancel_at_period_end = true where id = 'smoke-plan-gate';
select pg_temp.check_plan(public.course_owner_can_sell(pg_temp.uid(1)), 'cancel at period end retains entitlement');
update public.subscriptions set status = 'trialing', trial_end = now() + interval '14 days'
where id = 'smoke-plan-gate';
select pg_temp.check_plan(public.course_owner_can_sell(pg_temp.uid(1)), 'current trial');
update public.subscriptions set trial_end = now() where id = 'smoke-plan-gate';
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'expired trial');
update public.subscriptions set trial_end = null where id = 'smoke-plan-gate';
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'trial without expiry fails closed');
do $$ declare state text; begin
  foreach state in array array['past_due','unpaid','canceled','incomplete','incomplete_expired','paused'] loop
    update public.subscriptions set status = state where id = 'smoke-plan-gate';
    perform pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), state);
  end loop;
end $$;
update public.subscriptions set status = 'active', current_period_end = now() where id = 'smoke-plan-gate';
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'expired active period');
update public.subscriptions set current_period_end = null where id = 'smoke-plan-gate';
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'missing period fails closed');
update public.subscriptions set current_period_end = now() + interval '1 day', plan_id = 'free' where id = 'smoke-plan-gate';
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'legacy free is not a paid plan');
update public.subscriptions set plan_id = 'basic' where id = 'smoke-plan-gate';
insert into public.account_controls(uid, suspended, sessions_revoked_before)
values (pg_temp.uid(1), true, now()), (pg_temp.uid(2), true, now());
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'suspension wins over subscription');
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(2)), 'suspension wins over admin');
delete from public.account_controls where uid in (pg_temp.uid(1), pg_temp.uid(2));
update public.platform_settings set value = 'true' where key = 'require_activation_fee';
delete from public.creator_activation_waivers where uid = pg_temp.uid(1);
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'activation guard retained');
update public.platform_settings set value = 'false' where key = 'require_activation_fee';

insert into public.courses(id, owner_id, slug, title, summary, category, status, payment_type, price_amount_minor, currency, modules)
values ('smoke-plan-product', pg_temp.uid(1), 'smoke-plan-product', 'Plan smoke', 'A complete product for the plan smoke.',
  'smoke', 'draft', 'free', 0, 'USD', '[{"id":"m1","title":"Module","lessons":[{"id":"l1","title":"Lesson","type":"text","contentText":"Lesson content."}]}]');
update public.subscriptions set current_period_end = now() where id = 'smoke-plan-gate';
update public.courses set summary = 'Drafts remain editable without a plan.' where id = 'smoke-plan-product';
-- The trigger also covers trusted writes, not only the browser RPC.
do $$ begin
  begin
    insert into public.courses(id, owner_id, slug, title, summary, category, status, payment_type, price_amount_minor, currency)
    values ('smoke-plan-direct', pg_temp.uid(1), 'smoke-plan-direct', 'Direct publish', 'Cannot insert a published product.', 'smoke', 'published', 'free', 0, 'USD');
    raise exception 'CREATOR_PLAN_REGRESSION: published insert accepted';
  exception when raise_exception then
    if sqlerrm <> 'creator_plan_required' then raise; end if;
  end;
  begin
    update public.courses set status = 'published' where id = 'smoke-plan-product';
    raise exception 'CREATOR_PLAN_REGRESSION: direct publish accepted';
  exception when raise_exception then
    if sqlerrm <> 'creator_plan_required' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub', pg_temp.uid(1), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated','aal','aal2')::text, true);
select set_config('skillset.trusted_write', 'off', true);
set local role authenticated;
select pg_temp.check_plan(public.creator_plan_required(), 'browser gets own gate');
do $$ begin
  begin
    perform public.publish_teacher_course('smoke-plan-product');
    raise exception 'CREATOR_PLAN_REGRESSION: RPC publish accepted';
  exception when raise_exception then
    if sqlerrm <> 'creator_plan_required' then raise; end if;
  end;
end $$;
reset role;
select set_config('skillset.trusted_write', 'on', true);
update public.subscriptions set current_period_end = now() + interval '1 day' where id = 'smoke-plan-gate';
select set_config('skillset.trusted_write', 'off', true);
set local role authenticated;
select public.publish_teacher_course('smoke-plan-product');
reset role;
select set_config('skillset.trusted_write', 'on', true);
-- Expiry closes new sales but does not unpublish or remove existing access.
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, source, status)
values (pg_temp.uid(3) || '__smoke-plan-product', pg_temp.uid(3), 'smoke-plan-product', 'smoke-plan-product', 'Plan smoke', 'smoke', '', 'payment', 'active');
update public.subscriptions set current_period_end = now() where id = 'smoke-plan-gate';
update public.courses set summary = 'Existing content can still be maintained.' where id = 'smoke-plan-product';
select pg_temp.check_plan((select status = 'published' from public.courses where id = 'smoke-plan-product'), 'expiry does not unpublish');
select pg_temp.check_plan(not public.course_owner_can_sell(pg_temp.uid(1)), 'expiry closes new sales');
select pg_temp.check_plan(
  not has_function_privilege('anon','public.creator_plan_required()','execute')
  and has_function_privilege('authenticated','public.creator_plan_required()','execute')
  and not has_function_privilege('authenticated','public.creator_has_current_plan(text)','execute')
  and not has_function_privilege('anon','public.course_owner_can_sell(text)','execute')
  and not has_function_privilege('authenticated','public.course_owner_can_sell(text)','execute'), 'RPC grants');
select set_config('request.jwt.claim.sub', pg_temp.uid(3), true);
select set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.uid(3),'role','authenticated','aal','aal2')::text, true);
select set_config('skillset.trusted_write', 'off', true);
set local role authenticated;
select pg_temp.check_plan(public.has_enrollment_for_course_slug('smoke-plan-product'), 'existing learner still has classroom access');
select pg_temp.check_plan(public.lesson_is_released('smoke-plan-product', 'l1', pg_temp.uid(3)), 'existing learner keeps released lesson');
select pg_temp.check_plan((select status = 'active' from public.enrollments where id = pg_temp.uid(3) || '__smoke-plan-product'), 'existing enrollment unchanged');
reset role;
rollback;

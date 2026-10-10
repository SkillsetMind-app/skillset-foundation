\set ON_ERROR_STOP on
-- Disposable database only. No provider requests; fixtures are rolled back.
begin;
create function pg_temp.check_delivery(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'TRIAL_DELIVERY_REGRESSION: %', label; end if;
end $$;

do $$
declare
  first jsonb;
  retried jsonb;
  started timestamptz;
begin
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_started:sub_smoke')->>'action' = 'missing', 'no payload yet');
  first := public.claim_plan_trial_email('trial_started:sub_smoke', '{"text":"First preview"}');
  perform pg_temp.check_delivery(first->>'action' = 'send', 'first claim');
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_started:sub_smoke', '{"text":"Changed discount"}')->>'action' = 'busy', 'concurrent worker waits');
  perform pg_temp.check_delivery(not public.finish_plan_trial_email('trial_started:sub_smoke', gen_random_uuid(), 'accepted'), 'wrong worker cannot finish');
  perform pg_temp.check_delivery(public.finish_plan_trial_email('trial_started:sub_smoke', (first->>'token')::uuid, 'uncertain'), 'ambiguous send');
  select first_attempt_at into started from public.plan_trial_email_deliveries where idempotency_key = 'trial_started:sub_smoke';
  retried := public.claim_plan_trial_email('trial_started:sub_smoke', '{"text":"Changed discount"}');
  perform pg_temp.check_delivery(retried->>'payload' = first->>'payload', 'payload immutable across retry');
  perform pg_temp.check_delivery(public.finish_plan_trial_email('trial_started:sub_smoke', (retried->>'token')::uuid, 'rejected'), 'later rate limit');
  perform pg_temp.check_delivery((select first_attempt_at = started and uncertain from public.plan_trial_email_deliveries where idempotency_key = 'trial_started:sub_smoke'), 'rejection cannot erase earlier uncertainty');
  update public.plan_trial_email_deliveries set first_attempt_at = now() - interval '24 hours' where idempotency_key = 'trial_started:sub_smoke';
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_started:sub_smoke')->>'action' = 'manual', 'old uncertain delivery never resends');
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_started:sub_smoke')->>'action' = 'manual', 'manual state is sticky');

  first := public.claim_plan_trial_email('trial_will_end:sub_rejected', '{"text":"Reminder"}');
  perform public.finish_plan_trial_email('trial_will_end:sub_rejected', (first->>'token')::uuid, 'rejected');
  perform pg_temp.check_delivery((select first_attempt_at is null and not uncertain from public.plan_trial_email_deliveries where idempotency_key = 'trial_will_end:sub_rejected'), 'definite rejection permits later retry');
  update public.plan_trial_email_deliveries set created_at = now() - interval '2 days' where idempotency_key = 'trial_will_end:sub_rejected';
  retried := public.claim_plan_trial_email('trial_will_end:sub_rejected');
  perform pg_temp.check_delivery(retried->>'action' = 'send', 'old rejected delivery still retryable');
  perform public.finish_plan_trial_email('trial_will_end:sub_rejected', (retried->>'token')::uuid, 'accepted');
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_will_end:sub_rejected')->>'action' = 'done', 'confirmed delivery never resends');

  first := public.claim_plan_trial_email('trial_started:sub_crashed', '{"text":"Unknown outcome"}');
  update public.plan_trial_email_deliveries set lease_until = now() - interval '1 minute' where idempotency_key = 'trial_started:sub_crashed';
  retried := public.claim_plan_trial_email('trial_started:sub_crashed');
  perform pg_temp.check_delivery(retried->>'action' = 'send', 'expired lease retries within window');
  perform pg_temp.check_delivery(not public.finish_plan_trial_email('trial_started:sub_crashed', (first->>'token')::uuid, 'rejected'), 'stale worker fenced');
  perform public.finish_plan_trial_email('trial_started:sub_crashed', (retried->>'token')::uuid, 'rejected');
  perform pg_temp.check_delivery((select uncertain and first_attempt_at is not null from public.plan_trial_email_deliveries where idempotency_key = 'trial_started:sub_crashed'), 'crash remains uncertain after later rejection');
  update public.plan_trial_email_deliveries set first_attempt_at = now() - interval '23 hours 55 minutes' where idempotency_key = 'trial_started:sub_crashed';
  perform pg_temp.check_delivery(public.claim_plan_trial_email('trial_started:sub_crashed')->>'action' = 'manual', 'margin before provider expiry');
end $$;

select pg_temp.check_delivery(
  not has_table_privilege('anon', 'public.plan_trial_email_deliveries', 'select')
  and not has_table_privilege('authenticated', 'public.plan_trial_email_deliveries', 'select')
  and not has_table_privilege('service_role', 'public.plan_trial_email_deliveries', 'update')
  and not has_function_privilege('authenticated', 'public.claim_plan_trial_email(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.finish_plan_trial_email(text,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_plan_trial_email(text,text)', 'execute')
  and has_function_privilege('service_role', 'public.finish_plan_trial_email(text,uuid,text)', 'execute'), 'private payload and service-only state transitions');
select pg_temp.check_delivery(relrowsecurity and relforcerowsecurity, 'forced RLS')
from pg_class where oid = 'public.plan_trial_email_deliveries'::regclass;

set local role service_role;
do $$ declare result jsonb; begin
  result := public.claim_plan_trial_email('trial_started:sub_service', '{"text":"Service role"}');
  if result->>'action' is distinct from 'send'
    or not (result ?& array['payload', 'token', 'send_before'])
    or result->>'payload' <> '{"text":"Service role"}'
    or (result->>'send_before')::timestamptz <= clock_timestamp() then
    raise exception 'TRIAL_DELIVERY_REGRESSION: claim output schema';
  end if;
  if public.finish_plan_trial_email('trial_started:sub_service', (result->>'token')::uuid, 'accepted') is distinct from true then
    raise exception 'TRIAL_DELIVERY_REGRESSION: service role finish';
  end if;
  if public.claim_plan_trial_email('trial_started:sub_service') is distinct from '{"action":"done"}'::jsonb then
    raise exception 'TRIAL_DELIVERY_REGRESSION: done output schema';
  end if;
end $$;
reset role;

create function pg_temp.assert_delivery_private() returns void language plpgsql as $$
begin
  begin
    perform * from public.plan_trial_email_deliveries;
    raise exception 'TRIAL_DELIVERY_REGRESSION: private payload readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_plan_trial_email('trial_started:sub_forbidden', '{"text":"Forbidden"}');
    raise exception 'TRIAL_DELIVERY_REGRESSION: public claim permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finish_plan_trial_email('trial_started:sub_service', gen_random_uuid(), 'accepted');
    raise exception 'TRIAL_DELIVERY_REGRESSION: public finish permitted';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
select pg_temp.assert_delivery_private();
reset role;
set local role authenticated;
select pg_temp.assert_delivery_private();
reset role;
rollback;

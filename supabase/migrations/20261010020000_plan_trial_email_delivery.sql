-- Freeze the exact provider body before sending; never replay an uncertain
-- delivery beyond Resend's 24-hour deduplication window.
create table public.plan_trial_email_deliveries (
  idempotency_key text primary key,
  payload text not null check (jsonb_typeof(payload::jsonb) = 'object'),
  state text not null default 'ready' check (state in ('ready', 'sending', 'sent', 'manual')),
  first_attempt_at timestamptz,
  uncertain boolean not null default false,
  attempt_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.plan_trial_email_deliveries enable row level security;
alter table public.plan_trial_email_deliveries force row level security;
revoke all on public.plan_trial_email_deliveries from public, anon, authenticated, service_role;
grant select on public.plan_trial_email_deliveries to service_role;
create policy account_access_guard on public.plan_trial_email_deliveries as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

create function public.claim_plan_trial_email(p_key text, p_payload text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  delivery public.plan_trial_email_deliveries;
  ts timestamptz := clock_timestamp();
begin
  if p_key !~ '^trial_(started|will_end):sub_[A-Za-z0-9_]+$' then
    raise exception 'Invalid trial email key';
  end if;
  if p_payload is not null then
    insert into public.plan_trial_email_deliveries(idempotency_key, payload)
    values (p_key, p_payload) on conflict (idempotency_key) do nothing;
  end if;
  select * into delivery from public.plan_trial_email_deliveries
    where idempotency_key = p_key for update;
  if not found then return jsonb_build_object('action', 'missing'); end if;
  if delivery.state = 'sent' then return jsonb_build_object('action', 'done'); end if;
  if delivery.state = 'manual' then return jsonb_build_object('action', 'manual'); end if;
  ts := clock_timestamp();
  if delivery.state = 'sending' and delivery.lease_until > ts then
    return jsonb_build_object('action', 'busy');
  end if;
  -- A dead worker may have sent successfully. Keep that uncertainty even if a
  -- subsequent request is definitively rejected (e.g. a later HTTP 429).
  if delivery.state = 'sending' then delivery.uncertain := true; end if;
  -- Five minutes of margin for request transit before the provider's 24h limit.
  if delivery.first_attempt_at is not null
    and ts >= delivery.first_attempt_at + interval '23 hours 55 minutes' then
    update public.plan_trial_email_deliveries set state = 'manual', uncertain = true,
      lease_until = null where idempotency_key = p_key;
    return jsonb_build_object('action', 'manual');
  end if;
  update public.plan_trial_email_deliveries set state = 'sending',
    first_attempt_at = coalesce(delivery.first_attempt_at, ts),
    uncertain = delivery.uncertain, attempt_token = gen_random_uuid(),
    lease_until = ts + interval '1 minute'
    where idempotency_key = p_key returning * into delivery;
  return jsonb_build_object('action', 'send', 'payload', delivery.payload,
    'token', delivery.attempt_token, 'send_before', least(delivery.lease_until,
      delivery.first_attempt_at + interval '23 hours 55 minutes'));
end;
$$;

create function public.finish_plan_trial_email(p_key text, p_token uuid, p_outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare delivery public.plan_trial_email_deliveries;
begin
  if p_outcome not in ('accepted', 'rejected', 'uncertain') then
    raise exception 'Invalid trial email outcome';
  end if;
  select * into delivery from public.plan_trial_email_deliveries
    where idempotency_key = p_key for update;
  if not found or delivery.state <> 'sending' or delivery.attempt_token is distinct from p_token then
    return false;
  end if;
  update public.plan_trial_email_deliveries set
    state = case when p_outcome = 'accepted' then 'sent' else 'ready' end,
    sent_at = case when p_outcome = 'accepted' then clock_timestamp() else null end,
    uncertain = delivery.uncertain or p_outcome = 'uncertain',
    first_attempt_at = case when p_outcome = 'rejected' and not delivery.uncertain
      then null else delivery.first_attempt_at end,
    lease_until = null
    where idempotency_key = p_key;
  return true;
end;
$$;
revoke all on function public.claim_plan_trial_email(text, text),
  public.finish_plan_trial_email(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_plan_trial_email(text, text),
  public.finish_plan_trial_email(text, uuid, text) to service_role;

-- Creator payout country: uppercase ISO alpha-2, copied by the server from
-- Stripe's own account.country (create, refresh route, account.updated webhook).
-- Null = an account created before this column (Stripe locked those to US); the
-- refresh route and the webhook backfill it lazily.
alter table public.users add column if not exists stripe_connect_country text
  check (stripe_connect_country is null or stripe_connect_country ~ '^[A-Z]{2}$');

-- Same function as 20260910010000, copied in full. The ONLY change is
-- stripe_connect_country in the Stripe block, so a user cannot self-edit it.
create or replace function public.users_field_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trusted boolean := public.is_service_role()
    or coalesce(current_setting('skillset.trusted_write', true) = 'on', false);
  v_previous_privileged jsonb;
  v_next_privileged jsonb;
begin
  if tg_op = 'UPDATE' and new.roles is distinct from old.roles then
    if jsonb_typeof(new.roles) is distinct from 'array' then
      raise exception 'Roles must be a JSON array.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(new.roles) r(value)
      where jsonb_typeof(value) <> 'string') then
      raise exception 'Roles must be strings.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      into v_previous_privileged from jsonb_array_elements(coalesce(old.roles, '[]'::jsonb)) r(value)
      where value not in ('"guest"'::jsonb, '"student"'::jsonb, '"teacher"'::jsonb);
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
      into v_next_privileged from jsonb_array_elements(new.roles) r(value)
      where value not in ('"guest"'::jsonb, '"student"'::jsonb, '"teacher"'::jsonb);
    if old.uid = auth.uid()::text then
      if v_next_privileged = '[]'::jsonb then
        select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
          into new.roles from jsonb_array_elements(new.roles || v_previous_privileged) r(value);
        v_next_privileged := v_previous_privileged;
      end if;
      if not v_trusted and v_next_privileged is distinct from v_previous_privileged then
        raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_trusted or public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    if jsonb_typeof(coalesce(new.roles, '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Roles must be a JSON array.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(new.roles, '[]'::jsonb)) r(value)
      where value not in ('"guest"'::jsonb, '"student"'::jsonb, '"teacher"'::jsonb)) then
      raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
    end if;
    if coalesce(new.creator_verification_status, 'none') <> 'none'
       or new.activation_fee_paid_at is not null then
      raise exception 'users: creator gate fields are server-controlled';
    end if;
    return new;
  end if;

  if new.roles is distinct from old.roles
     and v_next_privileged is distinct from v_previous_privileged then
    raise exception 'users: privileged roles are server-controlled' using errcode = '42501';
  end if;

  if new.stripe_connected_account_id       is distinct from old.stripe_connected_account_id
     or new.stripe_connect_status          is distinct from old.stripe_connect_status
     or new.stripe_connect_charges_enabled is distinct from old.stripe_connect_charges_enabled
     or new.stripe_connect_payouts_enabled is distinct from old.stripe_connect_payouts_enabled
     or new.stripe_connect_updated_at      is distinct from old.stripe_connect_updated_at
     or new.stripe_connect_country         is distinct from old.stripe_connect_country
     or new.stripe_customer_id             is distinct from old.stripe_customer_id
     or new.current_plan_id                is distinct from old.current_plan_id then
    raise exception 'users: Stripe/billing/plan fields are server-controlled';
  end if;

  if new.creator_verification_status is distinct from old.creator_verification_status
     or new.activation_fee_paid_at is distinct from old.activation_fee_paid_at then
    raise exception 'users: creator gate fields are server-controlled';
  end if;
  return new;
end $$;
revoke all on function public.users_field_guard() from public, anon, authenticated;

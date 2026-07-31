-- Professional approval and storefront activation are server-controlled gates.
-- The self-update policy on public.users is intentionally broad for profile
-- editing, so the shared trigger must prevent clients from approving or
-- activating themselves with a direct Supabase update.
-- Applied to production through psql on 2026-07-31; this file is the versioned
-- source for new environments and future schema reconciliation.
create or replace function public.users_field_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.is_service_role()
     or public.is_admin()
     or current_setting('skillset.trusted_write', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.roles ? 'admin' then
      raise exception 'cannot self-assign admin role';
    end if;
    if coalesce(new.creator_verification_status, 'none') <> 'none'
       or new.activation_fee_paid_at is not null then
      raise exception 'users: creator gate fields are server-controlled';
    end if;
    return new;
  end if;

  -- Roles may change only within {student, teacher}, never when the row already
  -- carries an admin grant.
  if new.roles is distinct from old.roles then
    if (old.roles ? 'admin')
       or exists (
         select 1 from jsonb_array_elements_text(new.roles) r
         where r not in ('student', 'teacher')
       ) then
      raise exception 'users: role change not permitted (only student/teacher self-assignment)';
    end if;
  end if;

  if new.stripe_connected_account_id       is distinct from old.stripe_connected_account_id
     or new.stripe_connect_status          is distinct from old.stripe_connect_status
     or new.stripe_connect_charges_enabled is distinct from old.stripe_connect_charges_enabled
     or new.stripe_connect_payouts_enabled is distinct from old.stripe_connect_payouts_enabled
     or new.stripe_connect_updated_at      is distinct from old.stripe_connect_updated_at
     or new.stripe_customer_id             is distinct from old.stripe_customer_id
     or new.current_plan_id                is distinct from old.current_plan_id then
    raise exception 'users: Stripe/billing/plan fields are server-controlled';
  end if;

  if new.creator_verification_status is distinct from old.creator_verification_status
     or new.activation_fee_paid_at is distinct from old.activation_fee_paid_at then
    raise exception 'users: creator gate fields are server-controlled';
  end if;

  return new;
end;
$function$;

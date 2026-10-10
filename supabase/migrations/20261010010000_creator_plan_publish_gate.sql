-- Creator subscriptions are separate from learner access and activation waivers.
create function public.creator_has_current_plan(p_uid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.uid = p_uid and u.roles ? 'admin')
    or exists (
      select 1 from public.subscriptions s
      where s.user_id = p_uid
        and s.plan_id in ('basic', 'starter', 'pro', 'plus')
        and s.status in ('active', 'trialing')
        and s.current_period_end > now()
        and (s.status <> 'trialing' or s.trial_end > now())
    );
$$;
revoke all on function public.creator_has_current_plan(text) from public, anon, authenticated;
grant execute on function public.creator_has_current_plan(text) to service_role;

-- No UID argument: a browser may only inspect its own entitlement.
create function public.creator_plan_required() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_strong_session();
  if auth.uid() is null then
    raise exception 'The current account is required.' using errcode = '42501';
  end if;
  return not public.creator_has_current_plan(auth.uid()::text);
end;
$$;
revoke all on function public.creator_plan_required() from public, anon, authenticated;
grant execute on function public.creator_plan_required() to authenticated, service_role;

create or replace function public.course_owner_can_sell(p_owner_uid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from public.account_controls c where c.uid = p_owner_uid and c.suspended)
    and (exists (select 1 from public.users u where u.uid = p_owner_uid and u.roles ? 'admin')
      or not public.creator_activation_blocked(p_owner_uid))
    and public.creator_has_current_plan(p_owner_uid);
$$;
revoke all on function public.course_owner_can_sell(text) from public, anon, authenticated;
grant execute on function public.course_owner_can_sell(text) to service_role;

create function public.enforce_creator_plan_on_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' then
    -- Gate transitions, not learner counters or edits to an existing product.
    if tg_op = 'INSERT' then
      if not public.creator_has_current_plan(new.owner_id) then
        raise exception 'creator_plan_required' using errcode = 'P0001';
      end if;
    elsif old.status is distinct from new.status or old.owner_id is distinct from new.owner_id then
      if not public.creator_has_current_plan(new.owner_id) then
        raise exception 'creator_plan_required' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_creator_plan_on_publish() from public, anon, authenticated;
create trigger courses_creator_plan_gate
before insert or update on public.courses
for each row execute function public.enforce_creator_plan_on_publish();

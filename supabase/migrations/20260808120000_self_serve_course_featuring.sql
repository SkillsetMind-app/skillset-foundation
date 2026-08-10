-- Self-serve marketplace featuring, metered by plan.
--
-- Why an RPC and not a plain update: `courses.featured` and
-- `courses.featured_rank` are frozen columns. The trigger
-- `courses_freeze_privileged_columns()` raises for anyone who is not
-- service_role / admin / ops, UNLESS `skillset.trusted_write` is 'on'. A
-- teacher writing from the browser will always hit that exception, so the
-- quota check and the write have to live together in one SECURITY DEFINER
-- function. Same escape hatch already used by create_teacher_course_draft and
-- five other functions in the schema.
--
-- featured_rank stays NULL for self-serve. src/lib/data/course-sort.ts sorts
-- featured cards by rank ascending and treats NULL as MAX_SAFE_INTEGER, so a
-- self-featured course lands after every ops-curated pick without inventing a
-- number or carving out rank bands. Ops keeps full rank control through the
-- existing admin path.

-- Featured slots per plan. Mirrors `planEntitlements[*].quotas.featuredSlots`
-- in src/domain/entitlements.ts — the TypeScript copy drives the UI, this one
-- is the enforcement point. Only this quota descends into SQL; duplicating the
-- whole entitlement map here would just create two things to keep in sync.
create or replace function public.featured_slots_for_plan(p_plan_id text)
returns integer
language sql
immutable
as $function$
  select case coalesce(p_plan_id, 'free')
    when 'plus' then 5
    when 'pro' then 3
    when 'starter' then 1
    else 0
  end;
$function$;

comment on function public.featured_slots_for_plan(text) is
  'Marketplace highlight slots included in a plan. Keep in sync with featuredSlots in src/domain/entitlements.ts.';

-- ponytail: no read-side quota RPC. The manage hub already holds a realtime
-- subscription to every course the teacher owns, so "N of M used" is counted
-- from rows the client already has. A second round-trip would show the same
-- number, one render later.

-- Toggle a highlight on one of the caller's own published courses.
--
-- Unfeaturing is always allowed, including when the teacher is over quota
-- after a plan downgrade — otherwise a downgraded teacher would be stuck
-- unable to clean up their own state.
create or replace function public.set_own_course_featured(
  p_course_id text,
  p_featured boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_plan text;
  v_limit integer;
  v_used integer;
  v_status text;
  v_already boolean;
begin
  if v_uid is null then
    raise exception 'Sign in to manage your marketplace highlights.';
  end if;

  if p_course_id is null or btrim(p_course_id) = '' then
    raise exception 'A course is required.';
  end if;

  -- Lock the row so two concurrent requests cannot both pass the quota check
  -- and push the teacher one slot over the limit.
  select status, featured into v_status, v_already
  from public.courses
  where id = p_course_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'That course was not found in your account.';
  end if;

  if p_featured then
    if v_status is distinct from 'published' then
      raise exception 'Only a published course can be highlighted in the marketplace.';
    end if;

    select current_plan_id into v_plan from public.users where uid = v_uid;
    v_limit := public.featured_slots_for_plan(v_plan);

    if v_limit <= 0 then
      raise exception 'Marketplace highlights are not included in your current plan.';
    end if;

    select count(*)::integer into v_used
    from public.courses
    where owner_id = v_uid and featured and id <> p_course_id;

    if v_used >= v_limit then
      raise exception 'You are using all % marketplace highlights included in your plan. Remove one first, or request an expansion.', v_limit;
    end if;
  end if;

  if v_already is distinct from p_featured then
    perform set_config('skillset.trusted_write', 'on', true);

    update public.courses
    set featured = p_featured,
        -- Cleared on unfeature so a stale editorial rank cannot resurface if
        -- ops re-features the course later.
        featured_rank = case when p_featured then featured_rank else null end,
        updated_at = now()
    where id = p_course_id and owner_id = v_uid;

    perform set_config('skillset.trusted_write', 'off', true);
  end if;

  select current_plan_id into v_plan from public.users where uid = v_uid;
  select count(*)::integer into v_used
  from public.courses
  where owner_id = v_uid and featured;

  return jsonb_build_object(
    'courseId', p_course_id,
    'featured', p_featured,
    'planId', coalesce(v_plan, 'free'),
    'used', v_used,
    'limit', public.featured_slots_for_plan(v_plan)
  );
end;
$function$;

-- SECURITY DEFINER functions are executable by PUBLIC unless revoked, and
-- set_own_course_featured runs with the owner's rights past the freeze
-- trigger. It already rejects a null auth.uid(), but anon has no business
-- reaching it at all.
--
-- featured_slots_for_plan needs no caller grant: the only caller is the
-- SECURITY DEFINER function above, whose object privileges are checked
-- against the function owner, not the signed-in user.
revoke all on function public.featured_slots_for_plan(text) from public, anon, authenticated;
revoke all on function public.set_own_course_featured(text, boolean) from public, anon;

grant execute on function public.featured_slots_for_plan(text) to service_role;
grant execute on function public.set_own_course_featured(text, boolean) to authenticated, service_role;

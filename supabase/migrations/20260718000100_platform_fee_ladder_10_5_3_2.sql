-- Align the DB fee ladder with the 2026-07 commission pivot (10/5/3/2).
-- Follow-up to 20260716000100_live_teacher_course_rpcs.sql, which still
-- encoded the pre-pivot ladder (8/4/1/0). This function runs on every course
-- create/update RPC and snapshots courses.platform_fee_bps, so it must match
-- canonicalPlatformFeeBpsForPlan in src/lib/payments/rules.ts (the charging
-- source of truth) or the two "canonical" ladders silently diverge.

-- search_path is pinned (restores the intent of
-- 20260701062439_pin_platform_fee_bps_for_plan_search_path, which later
-- create-or-replace calls dropped). The body references no objects, so ''
-- is safe and it clears the mutable-search_path linter warning.
create or replace function public.platform_fee_bps_for_plan(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case p_plan
    when 'free' then 1000
    when 'starter' then 500
    when 'pro' then 300
    when 'plus' then 200
    else 1000
  end;
$function$;

-- Backfill: re-derive every course's fee snapshot from its owner's current
-- plan so no row keeps a pre-pivot 800/400/100/0 value. Safe pre-launch (no
-- fee-locked creators); orders already snapshot their own fee at checkout.
--
-- courses_freeze_privileged_columns() rejects any write to platform_fee_bps
-- that is not service_role/admin/ops, so the backfill has to announce itself
-- through the same escape hatch the trusted-write RPCs use. Without this the
-- statement below aborts the whole migration with "courses: ... are
-- privileged (admin/ops/service only)".
select set_config('skillset.trusted_write', 'on', true);

update public.courses c
set platform_fee_bps = public.platform_fee_bps_for_plan(u.current_plan_id)
from public.users u
where u.uid = c.owner_id
  and c.platform_fee_bps is distinct from public.platform_fee_bps_for_plan(u.current_plan_id);

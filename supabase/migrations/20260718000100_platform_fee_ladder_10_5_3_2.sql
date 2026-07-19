-- Align the DB fee ladder with the 2026-07 commission pivot (10/5/3/2).
-- Follow-up to 20260716000100_live_teacher_course_rpcs.sql, which still
-- encoded the pre-pivot ladder (8/4/1/0). This function runs on every course
-- create/update RPC and snapshots courses.platform_fee_bps, so it must match
-- canonicalPlatformFeeBpsForPlan in src/lib/payments/rules.ts (the charging
-- source of truth) or the two "canonical" ladders silently diverge.

create or replace function public.platform_fee_bps_for_plan(p_plan text)
returns integer
language sql
immutable
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
update public.courses c
set platform_fee_bps = public.platform_fee_bps_for_plan(u.current_plan_id)
from public.users u
where u.uid = c.owner_id
  and c.platform_fee_bps is distinct from public.platform_fee_bps_for_plan(u.current_plan_id);

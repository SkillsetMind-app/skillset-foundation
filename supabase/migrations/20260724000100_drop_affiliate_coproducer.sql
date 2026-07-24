-- 2026-07-24 — Pivot to Stripe direct charges: drop the revenue-splitting schema.
--
-- WHY: the platform no longer receives, holds, or remits creator money. Buyers
-- are charged directly on the teacher's connected account and Stripe pays the
-- teacher out on the teacher's own schedule. A platform that never touches the
-- funds cannot split them, so affiliate commissions and co-producer shares are
-- not "disabled features" — they are structurally impossible and the schema
-- that promised them is a lie in the database.
--
-- NOT APPLIED AUTOMATICALLY. This migration is DESTRUCTIVE (drops a table and
-- three columns). Before running it against production:
--   1. select count(*) from public.course_coproducers;
--   2. select count(*) from public.course_commerce_settings where affiliate_enabled;
-- If either is non-zero, export those rows first — every affiliate and
-- co-producer relationship must be settled outside the platform, because after
-- the pivot there is no platform balance from which to pay them.
--
-- The application code already works against BOTH schemas: it pins
-- p_affiliate_enabled=false / p_affiliate_commission_pct=0 /
-- p_affiliate_approval='manual' when calling the current 7-argument RPC
-- (see src/lib/data/course-commerce.ts). After this migration runs, remove
-- those three pinned params from that call site — the 4-argument signature
-- below will reject them.

-- 1) RPCs that only exist to split money.
drop function if exists public.invite_course_coproducer(text, text, integer);
drop function if exists public.revoke_course_coproducer(uuid);

-- 2) The co-producer table itself (RLS policies, indexes, and the realtime
--    publication entry go with it via CASCADE on the table drop).
do $$ begin
  alter publication supabase_realtime drop table public.course_coproducers;
exception when undefined_object then null; when undefined_table then null; end $$;

drop table if exists public.course_coproducers;

-- 3) Replace the settings RPC with a tax-only signature. The parameter list
--    changes, so `create or replace` would create an overload instead of
--    replacing — the old signature is dropped explicitly first.
drop function if exists public.upsert_course_commerce_settings(
  text, boolean, integer, text, boolean, jsonb, text
);

create or replace function public.upsert_course_commerce_settings(
  p_course_id text,
  p_tax_collection boolean,
  p_tax_regions jsonb,
  p_tax_registration_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_region jsonb;
  v_regions jsonb := coalesce(p_tax_regions, '[]'::jsonb);
  v_registration text := nullif(btrim(coalesce(p_tax_registration_id,'')), '');
begin
  if jsonb_typeof(v_regions) <> 'array' then
    raise exception 'Tax regions must be a list.';
  end if;
  if jsonb_array_length(v_regions) > 5 then
    raise exception 'Pick at most 5 tax regions.';
  end if;
  for v_region in select * from jsonb_array_elements(v_regions) loop
    if jsonb_typeof(v_region) <> 'string'
       or (v_region #>> '{}') not in
         ('United States','Brazil','European Union','United Kingdom','Other') then
      raise exception 'Unknown tax region.';
    end if;
  end loop;
  if v_registration is not null and char_length(v_registration) > 80 then
    raise exception 'Keep the tax registration under 80 characters.';
  end if;

  insert into public.course_commerce_settings
    (course_id, owner_id, tax_collection, tax_regions, tax_registration_id)
  values
    (p_course_id, v_uid, coalesce(p_tax_collection,false), v_regions, v_registration)
  on conflict (course_id) do update
    -- owner_id is refreshed so a transferred course heals its row.
    set owner_id = excluded.owner_id,
        tax_collection = excluded.tax_collection,
        tax_regions = excluded.tax_regions,
        tax_registration_id = excluded.tax_registration_id,
        updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.upsert_course_commerce_settings(text, boolean, jsonb, text)
  from public, anon;
grant execute on function
  public.upsert_course_commerce_settings(text, boolean, jsonb, text)
  to authenticated, service_role;

-- 4) The affiliate columns, dropped only after the RPC above stopped writing
--    them (order matters: dropping them first would break the live 7-arg RPC
--    for any request in flight during the migration).
alter table public.course_commerce_settings
  drop column if exists affiliate_enabled,
  drop column if exists affiliate_commission_pct,
  drop column if exists affiliate_approval;

-- 5) payout_ledger is DELIBERATELY KEPT and DELIBERATELY NOT DROPPED.
--    It stopped being a custody record (money the platform owes a teacher) and
--    became a read-only earnings record (money Stripe already paid the teacher
--    directly). The webhook still writes it to power creator reports and to
--    keep the duplicate-event guard armed. `release_at` is always null and
--    `status` now moves settled -> disputed -> settled|refunded.
comment on table public.payout_ledger is
  'Read-only earnings record under Stripe direct charges. The platform never '
  'held these funds: Stripe paid the connected account directly. status: '
  'settled | disputed | refunded | partially_refunded. release_at is legacy '
  'and always null — there is no platform hold period to release from.';

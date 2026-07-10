-- Course commerce hardening — review fixes for 20260710_course_commerce_operations.
-- Applied to production as migration `course_commerce_hardening`.
--
-- 1. course_coupons: redeemed_count can never exceed max_redemptions.
-- 2. assert_course_owner is an internal helper — not callable by clients.
-- 3. upsert_course_commerce_settings: cap the regions list BEFORE iterating it,
--    and refresh owner_id on conflict so a transferred course heals its row.
-- 4. set_course_coupon_active / delete_course_coupon / revoke_course_coproducer:
--    re-check ownership against the LIVE course row, not the stored snapshot,
--    so a transferred course's old owner loses access immediately.
-- 5. invite_course_coproducer: the share-cap message renders "45%" instead of
--    a bare parameter placeholder.

do $$
begin
  alter table public.course_coupons
    add constraint course_coupons_redeemed_within_cap
    check (redeemed_count <= max_redemptions);
exception
  when duplicate_object then null;
end $$;

revoke execute on function public.assert_course_owner(text) from authenticated;

create or replace function public.upsert_course_commerce_settings(
  p_course_id text,
  p_affiliate_enabled boolean,
  p_affiliate_commission_pct integer,
  p_affiliate_approval text,
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
  if p_affiliate_commission_pct is null
     or p_affiliate_commission_pct < 5 or p_affiliate_commission_pct > 60 then
    raise exception 'Affiliate commission must be between 5%% and 60%%.';
  end if;
  if p_affiliate_approval not in ('manual','automatic') then
    raise exception 'Partner approval must be manual or automatic.';
  end if;
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

  if coalesce(p_affiliate_enabled, false)
     and coalesce((
          select (ps.value #>> '{}')::boolean
          from public.platform_settings ps
          where ps.key = 'require_creator_verification'
        ), false)
     and coalesce((
          select u.creator_verification_status
          from public.users u where u.uid = v_uid
        ), 'none') <> 'approved' then
    raise exception 'Professional verification must be approved before the affiliate program can be enabled.';
  end if;

  insert into public.course_commerce_settings
    (course_id, owner_id, affiliate_enabled, affiliate_commission_pct,
     affiliate_approval, tax_collection, tax_regions, tax_registration_id)
  values
    (p_course_id, v_uid, coalesce(p_affiliate_enabled,false), p_affiliate_commission_pct,
     p_affiliate_approval, coalesce(p_tax_collection,false), v_regions, v_registration)
  on conflict (course_id) do update
    set owner_id = excluded.owner_id,
        affiliate_enabled = excluded.affiliate_enabled,
        affiliate_commission_pct = excluded.affiliate_commission_pct,
        affiliate_approval = excluded.affiliate_approval,
        tax_collection = excluded.tax_collection,
        tax_regions = excluded.tax_regions,
        tax_registration_id = excluded.tax_registration_id,
        updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.set_course_coupon_active(
  p_coupon_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_coupon public.course_coupons%rowtype;
  v_uid text;
begin
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  v_uid := public.assert_course_owner(v_coupon.course_id);
  if coalesce(p_active, false) then
    if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
      raise exception 'This coupon has expired — create a new one instead.';
    end if;
    if coalesce((
         select (ps.value #>> '{}')::boolean
         from public.platform_settings ps
         where ps.key = 'require_creator_verification'
       ), false)
       and coalesce((
         select u.creator_verification_status
         from public.users u where u.uid = v_uid
       ), 'none') <> 'approved' then
      raise exception 'Professional verification must be approved before a coupon can be activated.';
    end if;
  end if;

  update public.course_coupons
    set active = coalesce(p_active, false), updated_at = now()
  where id = p_coupon_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_course_coupon(
  p_coupon_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_coupon public.course_coupons%rowtype;
begin
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  perform public.assert_course_owner(v_coupon.course_id);
  -- No redemption engine yet, so redeemed_count is always 0; once redemptions
  -- exist this becomes an archive instead of a hard delete.
  delete from public.course_coupons where id = p_coupon_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.revoke_course_coproducer(
  p_coproducer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.course_coproducers%rowtype;
begin
  select * into v_row from public.course_coproducers where id = p_coproducer_id;
  if v_row.id is null then
    raise exception 'Co-producer invitation not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  perform public.assert_course_owner(v_row.course_id);
  if v_row.status = 'revoked' then
    return jsonb_build_object('success', true);
  end if;

  update public.course_coproducers
    set status = 'revoked', updated_at = now()
  where id = p_coproducer_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.invite_course_coproducer(
  p_course_id text,
  p_email text,
  p_share_pct integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_used integer;
  v_count integer;
begin
  -- Serialize invites per course so the share cap can't be raced past.
  perform 1 from public.courses where id = p_course_id for update;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid co-producer email address.';
  end if;
  if exists (select 1 from public.users u where u.uid = v_uid and lower(u.email) = v_email) then
    raise exception 'You already own this course — invite a different practitioner.';
  end if;
  if p_share_pct is null or p_share_pct < 5 or p_share_pct > 90 then
    raise exception 'Revenue share must be between 5%% and 90%%.';
  end if;
  select count(*), coalesce(sum(revenue_share_pct), 0)
    into v_count, v_used
  from public.course_coproducers
  where course_id = p_course_id and status in ('invited','accepted');
  if v_count >= 10 then
    raise exception 'This course already has 10 co-producers.';
  end if;
  if v_used + p_share_pct > 90 then
    raise exception 'Keep at least 10%% of revenue with the primary creator (% already allocated).', v_used::text || '%';
  end if;
  if exists (
    select 1 from public.course_coproducers
    where course_id = p_course_id
      and lower(invitee_email) = v_email
      and status in ('invited','accepted')
  ) then
    raise exception 'That practitioner already has a live invitation for this course.';
  end if;

  insert into public.course_coproducers (course_id, owner_id, invitee_email, revenue_share_pct)
  values (p_course_id, v_uid, v_email, p_share_pct);

  return jsonb_build_object('success', true);
end;
$$;

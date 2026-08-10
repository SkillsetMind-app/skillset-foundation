-- Unlimited coupon redemptions (the marketplace standard: Hotmart, Gumroad and
-- Stripe all treat "no limit" as an option, not an impossibility).
--
-- NULL max_redemptions == no cap. Every layer that enforced the cap now
-- short-circuits on NULL, explicitly. Postgres would already let NULL through
-- (`x >= NULL` is NULL, and a CHECK accepts NULL), but leaving a money guard
-- correct-by-accident is how it breaks the next time someone edits it.
--
-- Applied to production as migration `unlimited_coupon_redemptions`.

alter table public.course_coupons
  alter column max_redemptions drop not null;

alter table public.course_coupons
  drop constraint if exists course_coupons_max_redemptions_check;
alter table public.course_coupons
  add constraint course_coupons_max_redemptions_check
  check (
    max_redemptions is null
    or (max_redemptions >= 1 and max_redemptions <= 100000)
  );

alter table public.course_coupons
  drop constraint if exists course_coupons_redeemed_within_cap;
alter table public.course_coupons
  add constraint course_coupons_redeemed_within_cap
  check (max_redemptions is null or redeemed_count <= max_redemptions);

-- Creation: NULL is now a valid input meaning "unlimited". A supplied value is
-- still range-checked.
create or replace function public.create_course_coupon(
  p_course_id text,
  p_code text,
  p_percent_off integer,
  p_max_redemptions integer,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_code text := upper(btrim(coalesce(p_code,'')));
  v_count integer;
begin
  -- Serialize coupon writes per course (cap + duplicate checks below).
  perform 1 from public.courses where id = p_course_id for update;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then
    raise exception 'Coupon codes use 3-24 letters, numbers, or dashes.';
  end if;
  if p_percent_off is null or p_percent_off < 5 or p_percent_off > 90 then
    raise exception 'Discount must be between 5%% and 90%%.';
  end if;
  if p_max_redemptions is not null
     and (p_max_redemptions < 1 or p_max_redemptions > 100000) then
    raise exception 'Redemption limit must be between 1 and 100000, or blank for unlimited.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future.';
  end if;
  select count(*) into v_count from public.course_coupons where course_id = p_course_id;
  if v_count >= 50 then
    raise exception 'This course already has 50 coupons — remove one first.';
  end if;
  if exists (
    select 1 from public.course_coupons
    where course_id = p_course_id and code = v_code
  ) then
    raise exception 'That coupon code already exists for this course.';
  end if;

  insert into public.course_coupons
    (course_id, owner_id, code, percent_off, max_redemptions, expires_at)
  values
    (p_course_id, v_uid, v_code, p_percent_off, p_max_redemptions, p_expires_at);

  return jsonb_build_object('success', true, 'code', v_code);
end;
$function$;

-- Checkout reservation: an uncapped coupon never reaches its limit, so skip the
-- seat count entirely instead of relying on NULL arithmetic.
create or replace function public.reserve_course_coupon(
  p_coupon_id uuid,
  p_order_id text,
  p_user_id text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
  v_reserved_count integer;
  v_existing public.course_coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon
  FROM public.course_coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND OR v_coupon.active = false THEN
    RAISE EXCEPTION 'COUPON_UNAVAILABLE';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now() THEN
    RAISE EXCEPTION 'COUPON_EXPIRED';
  END IF;

  SELECT * INTO v_existing
  FROM public.course_coupon_reservations
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.coupon_id = p_coupon_id
       AND v_existing.user_id = p_user_id
       AND v_existing.status IN ('reserved', 'redeemed') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'COUPON_RESERVATION_CONFLICT';
  END IF;

  IF v_coupon.max_redemptions IS NOT NULL THEN
    -- Only reservations that are still live hold a slot.
    SELECT count(*)::integer INTO v_reserved_count
    FROM public.course_coupon_reservations
    WHERE coupon_id = p_coupon_id
      AND status = 'reserved'
      AND expires_at > now();

    IF v_coupon.redeemed_count + v_reserved_count >= v_coupon.max_redemptions THEN
      RAISE EXCEPTION 'COUPON_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO public.course_coupon_reservations (
    order_id, coupon_id, user_id, status, expires_at
  ) VALUES (
    p_order_id, p_coupon_id, p_user_id, 'reserved', p_expires_at
  );
END;
$function$;

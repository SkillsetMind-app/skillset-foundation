-- Course commerce operations (Hotmart-parity central): coupons, affiliate
-- program, co-producers, and tax signal — persisted per course, owner-scoped.
-- Additive only. Writes go through security-definer RPCs; activation actions
-- (affiliate enable, coupon activate) honor the require_creator_verification
-- platform flag so a pending creator can prepare but never expose commerce.
-- Redemption/attribution/settlement engines ship later; these tables are the
-- durable configuration + audit base they will consume.
-- Applied to production 2026-07-10 via MCP (advisors clean, smoke ok).

-- 1) Singleton commercial settings per course (affiliate + tax signal)
create table if not exists public.course_commerce_settings (
  course_id text primary key references public.courses(id) on delete cascade,
  owner_id text not null references public.users(uid) on delete cascade,
  affiliate_enabled boolean not null default false,
  affiliate_commission_pct integer not null default 25
    check (affiliate_commission_pct between 5 and 60),
  affiliate_approval text not null default 'manual'
    check (affiliate_approval in ('manual','automatic')),
  tax_collection boolean not null default false,
  tax_regions jsonb not null default '[]'::jsonb,
  tax_registration_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_commerce_settings_owner_idx
  on public.course_commerce_settings (owner_id);

-- 2) Coupons (created paused; activation is verification-gated)
create table if not exists public.course_coupons (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  owner_id text not null references public.users(uid) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  percent_off integer not null check (percent_off between 5 and 90),
  max_redemptions integer not null default 100
    check (max_redemptions between 1 and 100000),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  expires_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, code)
);
create index if not exists course_coupons_owner_idx
  on public.course_coupons (owner_id);
create index if not exists course_coupons_course_created_idx
  on public.course_coupons (course_id, created_at desc);

-- 3) Co-producers (invitation records; accept/settlement flow ships later)
create table if not exists public.course_coproducers (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id) on delete cascade,
  owner_id text not null references public.users(uid) on delete cascade,
  invitee_email text not null,
  revenue_share_pct integer not null check (revenue_share_pct between 5 and 90),
  status text not null default 'invited'
    check (status in ('invited','accepted','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists course_coproducers_owner_idx
  on public.course_coproducers (owner_id);
create index if not exists course_coproducers_course_idx
  on public.course_coproducers (course_id, created_at asc);
-- One live invitation per email per course.
create unique index if not exists course_coproducers_open_invite_uniq
  on public.course_coproducers (course_id, lower(invitee_email))
  where status in ('invited','accepted');

alter table public.course_commerce_settings enable row level security;
alter table public.course_coupons enable row level security;
alter table public.course_coproducers enable row level security;

drop policy if exists course_commerce_settings_owner_read on public.course_commerce_settings;
create policy course_commerce_settings_owner_read on public.course_commerce_settings
  for select to authenticated
  using (owner_id = (select auth.uid())::text or public.is_ops() or public.is_admin());
drop policy if exists course_coupons_owner_read on public.course_coupons;
create policy course_coupons_owner_read on public.course_coupons
  for select to authenticated
  using (owner_id = (select auth.uid())::text or public.is_ops() or public.is_admin());
drop policy if exists course_coproducers_owner_read on public.course_coproducers;
create policy course_coproducers_owner_read on public.course_coproducers
  for select to authenticated
  using (owner_id = (select auth.uid())::text or public.is_ops() or public.is_admin());
-- All writes go through the security-definer RPCs below; no write policies.

-- Helper used by every RPC in this file: resolves the caller and asserts
-- course ownership. Raises a user-facing message otherwise.
create or replace function public.assert_course_owner(p_course_id text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
begin
  if v_uid is null then
    raise exception 'Sign in to manage this course.';
  end if;
  select c.owner_id into v_owner from public.courses c where c.id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can manage its commerce settings.';
  end if;
  return v_uid;
end;
$function$;

create or replace function public.upsert_course_commerce_settings(
  p_course_id text,
  p_affiliate_enabled boolean,
  p_affiliate_commission_pct integer,
  p_affiliate_approval text,
  p_tax_collection boolean,
  p_tax_regions jsonb,
  p_tax_registration_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_region jsonb;
  v_regions jsonb := coalesce(p_tax_regions, '[]'::jsonb);
  v_count integer := 0;
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
  for v_region in select * from jsonb_array_elements(v_regions) loop
    v_count := v_count + 1;
    if jsonb_typeof(v_region) <> 'string'
       or (v_region #>> '{}') not in
         ('United States','Brazil','European Union','United Kingdom','Other') then
      raise exception 'Unknown tax region.';
    end if;
  end loop;
  if v_count > 5 then
    raise exception 'Pick at most 5 tax regions.';
  end if;
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
    set affiliate_enabled = excluded.affiliate_enabled,
        affiliate_commission_pct = excluded.affiliate_commission_pct,
        affiliate_approval = excluded.affiliate_approval,
        tax_collection = excluded.tax_collection,
        tax_regions = excluded.tax_regions,
        tax_registration_id = excluded.tax_registration_id,
        updated_at = now();

  return jsonb_build_object('success', true);
end;
$function$;

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
  if p_max_redemptions is null or p_max_redemptions < 1 or p_max_redemptions > 100000 then
    raise exception 'Redemption limit must be between 1 and 100000.';
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

create or replace function public.set_course_coupon_active(
  p_coupon_id uuid,
  p_active boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_coupon public.course_coupons%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to manage this course.';
  end if;
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  if v_coupon.owner_id <> v_uid then
    raise exception 'Only the course owner can manage its coupons.';
  end if;
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
$function$;

create or replace function public.delete_course_coupon(
  p_coupon_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_coupon public.course_coupons%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to manage this course.';
  end if;
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  if v_coupon.owner_id <> v_uid then
    raise exception 'Only the course owner can manage its coupons.';
  end if;
  -- No redemption engine yet, so redeemed_count is always 0; once redemptions
  -- exist this becomes an archive instead of a hard delete.
  delete from public.course_coupons where id = p_coupon_id;
  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.invite_course_coproducer(
  p_course_id text,
  p_email text,
  p_share_pct integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    raise exception 'Keep at least 10%% of revenue with the primary creator (% already allocated).', v_used;
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
$function$;

create or replace function public.revoke_course_coproducer(
  p_coproducer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_row public.course_coproducers%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to manage this course.';
  end if;
  select * into v_row from public.course_coproducers where id = p_coproducer_id;
  if v_row.id is null then
    raise exception 'Co-producer invitation not found.';
  end if;
  if v_row.owner_id <> v_uid then
    raise exception 'Only the course owner can manage co-producers.';
  end if;
  if v_row.status = 'revoked' then
    return jsonb_build_object('success', true);
  end if;

  update public.course_coproducers
    set status = 'revoked', updated_at = now()
  where id = p_coproducer_id;

  return jsonb_build_object('success', true);
end;
$function$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.assert_course_owner(text)',
    'public.upsert_course_commerce_settings(text,boolean,integer,text,boolean,jsonb,text)',
    'public.create_course_coupon(text,text,integer,integer,timestamptz)',
    'public.set_course_coupon_active(uuid,boolean)',
    'public.delete_course_coupon(uuid)',
    'public.invite_course_coproducer(text,text,integer)',
    'public.revoke_course_coproducer(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.course_commerce_settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.course_coupons;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.course_coproducers;
exception when duplicate_object then null; end $$;

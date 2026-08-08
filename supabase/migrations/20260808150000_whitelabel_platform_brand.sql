-- Sub-plan 4: remove the SkillsetMind mark for the plans that were sold on it.
--
-- Plan gate mirrors planEntitlements[*].features.removePlatformBranding in
-- src/domain/entitlements.ts: off on free and starter, on from pro up.
-- src/domain/entitlements.test.tsx fails if the TypeScript copy and this SQL
-- ever drift, same guard used by the featured-slot and certificate migrations.
--
-- Two surfaces, two very different lifetimes, so two mechanisms:
--
--   1. CERTIFICATE (permanent). Snapshotted at issuance next to teacher_name,
--      teacher_signature_url and sponsor_logo_url. A teacher who downgrades
--      later does not have the platform mark reprinted onto credentials already
--      in learners' hands, and a teacher who upgrades later does not get old
--      certificates silently rewritten. The verification block is NOT part of
--      the brand: a certificate nobody can verify is worth nothing, so the code
--      and the verify URL stay on every certificate regardless of plan.
--
--   2. MEMBER AREA (live). Published as a boolean inside the existing
--      public_profiles storefront projection. It is a capability flag, never
--      the plan id: `public_profiles` is world-readable by `anon`, and what a
--      teacher pays us is nobody else's business. The trigger already fires on
--      current_plan_id, so an upgrade or downgrade re-projects on its own.
--
-- Idempotent: `add column if not exists` + `create or replace function`.

-- 1. Certificate snapshot column ------------------------------------------

alter table public.certificates
  add column if not exists hide_platform_brand boolean not null default false;

comment on column public.certificates.hide_platform_brand is
  'Snapshot of the course owner''s removePlatformBranding entitlement at issuance (pro/plus). Drives the certificate header only; the verification code always prints.';

-- 2. Issuance RPC: stamp the whitelabel decision --------------------------

create or replace function public.issue_skillset_certificate(
  p_enrollment_id text,
  p_full_name text
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_full_name text;
  v_enrollment public.enrollments%rowtype;
  v_cert public.certificates%rowtype;
  v_course public.courses%rowtype;
  v_owner public.users%rowtype;
  v_teacher_name text;
  v_teacher_sig text;
  v_teacher_logo text;
  v_hide_brand boolean := false;
  v_code text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before requesting a certificate.' using errcode = 'P0001';
  end if;

  p_enrollment_id := btrim(coalesce(p_enrollment_id, ''));
  if p_enrollment_id = '' or length(p_enrollment_id) > 220 then
    raise exception 'A valid enrollmentId is required.' using errcode = 'P0001';
  end if;

  v_full_name := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  if length(v_full_name) < 2 or length(v_full_name) > 120 then
    raise exception 'Enter the full name (2-120 characters) to print on the certificate.'
      using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('certificate_issue_' || v_uid, 20, 3600000);

  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only request your own certificate.' using errcode = 'P0001';
  end if;
  if v_enrollment.status <> 'completed'
     and coalesce(v_enrollment.progress_percent, 0) < 100 then
    raise exception 'Complete the course before requesting a certificate.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status in ('refunded', 'revoked', 'expired') then
    raise exception 'This enrollment is not eligible for certificate issuance.'
      using errcode = 'P0001';
  end if;

  select * into v_cert
  from public.certificates
  where id = p_enrollment_id
  for update;
  if found then
    if v_cert.status = 'revoked' then
      raise exception 'This certificate was revoked by Skillset operations.'
        using errcode = 'P0001';
    end if;
    update public.certificates
    set status = 'issued', updated_at = v_now
    where id = p_enrollment_id;
    return p_enrollment_id;
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;
  if found then
    select * into v_owner
    from public.users
    where uid = v_course.owner_id;
    if found then
      v_teacher_name := nullif(btrim(coalesce(v_owner.display_name, '')), '');
      v_teacher_sig := nullif(coalesce(v_owner.teacher_signature_url, ''), '');

      -- Teacher brand mark, plan-gated. Mirrors features.certificateOwnLogo.
      if coalesce(v_owner.current_plan_id, 'free') <> 'free' then
        v_teacher_logo := nullif(
          btrim(coalesce(v_owner.storefront -> 'branding' ->> 'logoUrl', '')),
          ''
        );
        -- Same https-only rule the storefront projection enforces on write, so a
        -- row edited outside the app can never inject a javascript: or data: URL
        -- into a document learners share publicly.
        if v_teacher_logo is not null and v_teacher_logo !~* '^https://' then
          v_teacher_logo := null;
        end if;
      end if;

      -- Whitelabel header, plan-gated. Mirrors features.removePlatformBranding.
      -- Narrower than the logo gate above on purpose: starter co-brands, pro
      -- replaces.
      v_hide_brand := coalesce(v_owner.current_plan_id, 'free') in ('pro', 'plus');
    end if;
  end if;

  v_code := 'SK-'
    || upper(left(regexp_replace(p_enrollment_id, '[^a-zA-Z0-9]', '', 'g'), 18))
    || '-'
    || upper(to_hex((extract(epoch from v_now) * 1000)::bigint));

  insert into public.certificates (
    id, enrollment_id, user_id, course_id, course_slug, course_title,
    course_category, authority_label, status, verification_code,
    student_full_name, teacher_name, teacher_signature_url, sponsor_logo_url,
    hide_platform_brand, issued_at, created_at, updated_at
  ) values (
    p_enrollment_id, p_enrollment_id, v_enrollment.user_id, v_enrollment.course_id,
    v_enrollment.course_slug, v_enrollment.course_title, v_enrollment.course_category,
    'Skillset Verified', 'issued', v_code,
    v_full_name, v_teacher_name, v_teacher_sig, v_teacher_logo,
    v_hide_brand, v_now, v_now, v_now
  );

  return p_enrollment_id;
end;
$function$;

-- 3. Storefront projection: publish the capability, never the plan ---------

create or replace function public.public_storefront_projection(
  p_storefront jsonb,
  p_plan_id text
)
returns jsonb
language sql
immutable
as $projection$
  select case
    when coalesce(p_plan_id, 'free') = 'free' then null
    else nullif(
      jsonb_strip_nulls(
        jsonb_build_object(
          'branding',
          nullif(
            jsonb_strip_nulls(
              jsonb_build_object(
                -- `true` or absent. Never `false`: jsonb_strip_nulls only drops
                -- nulls, and shipping an explicit false would tell every
                -- anonymous reader which teachers are on the cheaper plans.
                'hidePlatformBrand',
                case
                  when coalesce(p_plan_id, 'free') in ('pro', 'plus') then true
                end,
                'themePreset',
                case
                  when s -> 'branding' ->> 'themePreset'
                       in ('default', 'warm', 'cool', 'mono')
                  then s -> 'branding' ->> 'themePreset'
                end,
                'accentColor',
                case
                  when s -> 'branding' ->> 'accentColor' ~ '^#[0-9a-fA-F]{6}$'
                  then s -> 'branding' ->> 'accentColor'
                end,
                'logoUrl',
                case
                  when s -> 'branding' ->> 'logoUrl' ~* '^https://'
                  then s -> 'branding' ->> 'logoUrl'
                end,
                'heroImageUrl',
                case
                  when s -> 'branding' ->> 'heroImageUrl' ~* '^https://'
                  then s -> 'branding' ->> 'heroImageUrl'
                end
              )
            ),
            '{}'::jsonb
          ),
          'showcase',
          nullif(
            jsonb_strip_nulls(
              jsonb_build_object(
                'tagline',
                nullif(
                  btrim(left(coalesce(s -> 'showcase' ->> 'tagline', ''), 200)),
                  ''
                ),
                'featuredCourseId',
                nullif(btrim(coalesce(s -> 'showcase' ->> 'featuredCourseId', '')), ''),
                'orderedCourseIds',
                case
                  when jsonb_typeof(s -> 'showcase' -> 'orderedCourseIds') = 'array'
                  then s -> 'showcase' -> 'orderedCourseIds'
                end
              )
            ),
            '{}'::jsonb
          )
        )
      ),
      '{}'::jsonb
    )
  end
  -- Coalesced so a pro/plus teacher who never opened the storefront editor
  -- still gets the whitelabel flag published. Before this, `storefront is null`
  -- returned early and the paid feature silently did nothing.
  from (select coalesce(p_storefront, '{}'::jsonb) as s) t;
$projection$;

-- 4. Republish every profile through the new rules -------------------------

update public.public_profiles pp
set storefront = public.public_storefront_projection(u.storefront, u.current_plan_id),
    updated_at = now()
from public.users u
where u.uid = pp.uid;

-- 5. Verify -----------------------------------------------------------------

do $check$
declare
  furados integer;
  faltando integer;
begin
  select count(*) into furados
  from public.public_profiles pp
  join public.users u on u.uid = pp.uid
  where coalesce(pp.storefront -> 'branding' ->> 'hidePlatformBrand', 'false') = 'true'
    and coalesce(u.current_plan_id, 'free') not in ('pro', 'plus');
  assert furados = 0,
    format('trava de whitelabel furada: %s perfil(is) sem plano pro/plus com a marca removida', furados);

  select count(*) into faltando
  from public.public_profiles pp
  join public.users u on u.uid = pp.uid
  where coalesce(u.current_plan_id, 'free') in ('pro', 'plus')
    and coalesce(pp.storefront -> 'branding' ->> 'hidePlatformBrand', 'false') <> 'true';
  assert faltando = 0,
    format('projecao incompleta: %s perfil(is) pro/plus sem a flag de whitelabel', faltando);

  raise notice 'whitelabel aplicado: certificado + area de membros';
end
$check$;

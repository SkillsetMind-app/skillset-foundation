-- Sub-plan 2: print the teacher's own brand mark on the certificates they issue.
--
-- Nothing new is stored and nothing new is rendered. The teacher ALREADY uploads
-- a logo (storefront branding, `users.storefront -> 'branding' ->> 'logoUrl'`,
-- saved by src/components/teacher/storefront-settings-panel.tsx) and the
-- certificate ALREADY draws a co-brand slot (`sponsor_logo_url`, rendered in
-- src/components/certificates/certificate-document.tsx). The issuance RPC was
-- the one missing link: it snapshotted display_name and teacher_signature_url
-- off the owner row but hardcoded `null` for the logo.
--
-- Plan gate mirrors planEntitlements[*].features.certificateOwnLogo in
-- src/domain/entitlements.ts: off on free, on from starter up. Inlined rather
-- than given its own helper function because nothing outside this RPC reads it;
-- src/domain/entitlements.test.tsx has a test that fails if the two drift.
--
-- Snapshot semantics, same as the signature: the logo is captured at FIRST
-- issuance and never re-read. A teacher who changes their logo later does not
-- retroactively rewrite certificates already in learners' hands, and a teacher
-- who downgrades does not lose the mark on credentials already issued.

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
    issued_at, created_at, updated_at
  ) values (
    p_enrollment_id, p_enrollment_id, v_enrollment.user_id, v_enrollment.course_id,
    v_enrollment.course_slug, v_enrollment.course_title, v_enrollment.course_category,
    'Skillset Verified', 'issued', v_code,
    v_full_name, v_teacher_name, v_teacher_sig, v_teacher_logo,
    v_now, v_now, v_now
  );

  return p_enrollment_id;
end;
$function$;

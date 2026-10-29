-- Matricula e certificado usam a mesma ordem de locks: matricula, certificado.
-- A atualizacao de status refunded ja trava a matricula. O trigger retira
-- apenas certificados issued, sem engolir erros e sem efeitos Stripe.
-- Repetir o UPDATE repara tambem uma revogacao legada incompleta.
-- Nao faz backfill: casos historicos exigem reconciliacao autorizada.
begin;

create or replace function public.refund_enrollment_certificate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.certificates
  set status = 'refund_revoked', updated_at = now()
  where enrollment_id = new.id and status = 'issued';
  return new;
end;
$function$;

revoke all on function public.refund_enrollment_certificate()
  from public, anon, authenticated, service_role;

drop trigger if exists enrollments_refund_certificate on public.enrollments;
create trigger enrollments_refund_certificate
  after update of status on public.enrollments
  for each row when (new.status = 'refunded')
  execute function public.refund_enrollment_certificate();

-- Corpo vigente de 20261007020000, somente a leitura da matricula ganha lock.
-- CREATE OR REPLACE preserva assinatura, dono e grants da RPC.
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
  v_total_lessons integer;
  v_completed_lessons integer;
begin
  perform public.require_strong_session();

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
  where id = p_enrollment_id for update;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only request your own certificate.' using errcode = 'P0001';
  end if;

  -- Um e-book e um arquivo para baixar: marcar a unica aula como vista nao e
  -- concluir um curso. A sala tambem nao oferece o botao.
  if exists (
    select 1 from public.courses c
    where c.id = v_enrollment.course_id and c.product_format = 'ebook'
  ) then
    raise exception 'E-books do not issue certificates.' using errcode = 'P0001';
  end if;

  -- Conclusao ao vivo: o progress_percent gravado pode estar velho.
  select count(*), count(lp.lesson_id)
    into v_total_lessons, v_completed_lessons
  from (
    select distinct lesson->>'id' as lid
    from public.courses c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.modules) = 'array' then c.modules else '[]'::jsonb end
    ) as m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m->'lessons') = 'array' then m->'lessons' else '[]'::jsonb end
    ) as lesson
    where c.id = v_enrollment.course_id
      and coalesce(lesson->>'id', '') <> ''
  ) s
  left join public.lesson_progress lp
    on lp.enrollment_id = p_enrollment_id and lp.lesson_id = s.lid;
  if v_total_lessons = 0 or v_completed_lessons < v_total_lessons then
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
    'SkillsetMind Verified', 'issued', v_code,
    v_full_name, v_teacher_name, v_teacher_sig, v_teacher_logo,
    v_hide_brand, v_now, v_now, v_now
  );

  return p_enrollment_id;
end;
$function$;

commit;

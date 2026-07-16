-- Reproduce the remaining RPCs invoked by application code.
-- Bodies come from live pg_get_functiondef snapshots where available, and from
-- the exact migrations applied to the live project for the remaining RPCs.

-- The older live function used bigint for p_window_ms. Recreate its live
-- semantics with the versioned integer signature before removing the old
-- overload, so this migration does not depend on an untracked predecessor.
create or replace function public.enforce_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_window_started timestamptz;
  v_count integer;
  v_in_window boolean;
begin
  select window_started_at, count
    into v_window_started, v_count
  from public.rate_limits
  where key = p_key
  for update;

  v_in_window := v_window_started is not null
    and (extract(epoch from (v_now - v_window_started)) * 1000) < p_window_ms;

  if v_in_window and v_count >= p_limit then
    raise exception 'RATE_LIMIT: too many attempts, please wait before trying again'
      using errcode = 'P0001';
  end if;

  insert into public.rate_limits (key, count, window_started_at, updated_at)
  values (p_key, 1, v_now, v_now)
  on conflict (key) do update
  set count = case
        when v_in_window then public.rate_limits.count + 1
        else 1
      end,
      window_started_at = case
        when v_in_window then public.rate_limits.window_started_at
        else v_now
      end,
      updated_at = v_now;
end;
$function$;

drop function if exists public.enforce_rate_limit(text, integer, bigint);

revoke execute on function public.enforce_rate_limit(text, integer, integer)
  from public;
grant execute on function public.enforce_rate_limit(text, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.create_free_course_enrollment(p_course_id text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course public.courses%rowtype;
  v_enrollment_id text;
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'unauthenticated: sign in before enrolling';
  end if;

  if p_course_id is null or length(btrim(p_course_id)) = 0 or length(p_course_id) > 160 then
    raise exception 'invalid-argument: a valid courseId is required';
  end if;

  perform public.enforce_rate_limit('free_enroll_' || v_uid, 20, 3600000);

  v_enrollment_id := v_uid || '__' || p_course_id;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'not-found: course not found';
  end if;

  if v_course.status <> 'published' then
    raise exception 'failed-precondition: this course is not available for enrollment right now';
  end if;

  if not (v_course.payment_type = 'free' or coalesce(v_course.price_amount_minor, 0) = 0) then
    raise exception 'failed-precondition: this course requires checkout before enrollment';
  end if;

  select status into v_existing_status
  from public.enrollments
  where id = v_enrollment_id;
  if v_existing_status in ('active', 'completed') then
    return v_enrollment_id;
  end if;

  insert into public.enrollments (
    id, user_id, course_id, course_slug, course_title, course_category, course_image,
    status, source, progress_percent, last_lesson_id, created_at, updated_at
  ) values (
    v_enrollment_id, v_uid, p_course_id, p_course_id, v_course.title, v_course.category,
    coalesce(v_course.cover_image_url, '/brand/logo-mark.png'),
    'active', 'free_course', 0, null, now(), now()
  )
  on conflict (id) do update set
    status = 'active',
    updated_at = now()
  where public.enrollments.status not in ('active', 'completed');

  return v_enrollment_id;
end;
$function$;

create or replace function public.request_account_action(p_type text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_email text;
  v_request_id text := gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in before requesting account actions'
      using errcode = 'P0001';
  end if;

  if p_type not in ('data_export', 'account_deletion') then
    raise exception 'INVALID_ARGUMENT: unknown account action type'
      using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit(
    'account_action_' || p_type || '_' || v_uid,
    4,
    86400000
  );

  select email into v_email
  from auth.users
  where id = (select auth.uid());

  insert into public.account_action_requests
    (id, type, requested_by, email, status, requested_at, updated_at)
  values (v_request_id, p_type, v_uid, v_email, 'pending', now(), now());

  perform public.log_audit_event(
    case when p_type = 'account_deletion'
      then 'account.deletion_requested'
      else 'account.data_export_requested' end,
    v_uid,
    v_email,
    'user',
    v_uid,
    case when p_type = 'account_deletion'
      then 'Account deletion requested'
      else 'Personal data export requested' end,
    jsonb_build_object('requestId', v_request_id, 'type', p_type)
  );

  return v_request_id;
end;
$function$;

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
    v_full_name, v_teacher_name, v_teacher_sig, null,
    v_now, v_now, v_now
  );

  return p_enrollment_id;
end;
$function$;

create or replace function public.verify_skillset_certificate(
  p_code text,
  p_rate_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_key text;
  v_cert public.certificates%rowtype;
begin
  if v_code = '' or length(v_code) > 80 then
    raise exception 'A valid verification code is required.' using errcode = 'P0001';
  end if;

  v_key := coalesce(
    (select auth.uid())::text,
    nullif(btrim(coalesce(p_rate_key, '')), ''),
    'anon'
  );
  perform public.enforce_rate_limit('cert_verify_' || v_key, 60, 3600000);

  select * into v_cert
  from public.certificates
  where verification_code = v_code and status = 'issued'
  limit 1;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'certificate', jsonb_build_object(
      'courseTitle', v_cert.course_title,
      'courseCategory', v_cert.course_category,
      'authorityLabel', coalesce(
        nullif(v_cert.authority_label, ''),
        'Skillset Verified'
      ),
      'verificationCode', v_cert.verification_code,
      'issuedAt', to_jsonb(v_cert.issued_at)
    )
  );
end;
$function$;

create or replace function public.record_lesson_progress(
  p_enrollment_id text,
  p_lesson_id text,
  p_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_enrollment_id text;
  v_lesson_id text;
  v_enrollment public.enrollments%rowtype;
  v_course public.courses%rowtype;
  v_valid_ids text[];
  v_total_lessons integer;
  v_completed_count integer;
  v_progress integer;
  v_status text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before tracking progress.' using errcode = 'P0001';
  end if;

  v_enrollment_id := btrim(coalesce(p_enrollment_id, ''));
  if v_enrollment_id = '' or length(v_enrollment_id) > 220 then
    raise exception 'A valid enrollmentId is required.' using errcode = 'P0001';
  end if;
  v_lesson_id := btrim(coalesce(p_lesson_id, ''));
  if v_lesson_id = '' or length(v_lesson_id) > 200 then
    raise exception 'A valid lessonId is required.' using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('lesson_progress_' || v_uid, 200, 3600000);

  select * into v_enrollment
  from public.enrollments
  where id = v_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only update progress for your own enrollments.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status in ('refunded', 'revoked', 'expired') then
    raise exception 'This enrollment is no longer active.' using errcode = 'P0001';
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_course.modules) = 'array' then
    select coalesce(array_agg(distinct lid), array[]::text[])
      into v_valid_ids
    from (
      select lesson->>'id' as lid
      from jsonb_array_elements(v_course.modules) as m
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(m->'lessons') = 'array'
          then m->'lessons'
          else '[]'::jsonb
        end
      ) as lesson
      where coalesce(lesson->>'id', '') <> ''
    ) s;
  else
    v_valid_ids := array[]::text[];
  end if;

  v_total_lessons := coalesce(array_length(v_valid_ids, 1), 0);

  if not (v_lesson_id = any(v_valid_ids)) then
    raise exception 'That lesson does not belong to this course.'
      using errcode = 'P0001';
  end if;

  if p_completed then
    insert into public.lesson_progress
      (enrollment_id, lesson_id, user_id, completed_at)
    values (v_enrollment_id, v_lesson_id, v_uid, v_now)
    on conflict (enrollment_id, lesson_id) do update set
      completed_at = v_now,
      user_id = v_uid;
  else
    delete from public.lesson_progress
    where enrollment_id = v_enrollment_id and lesson_id = v_lesson_id;
  end if;

  select count(*) into v_completed_count
  from public.lesson_progress
  where enrollment_id = v_enrollment_id and lesson_id = any(v_valid_ids);

  if v_total_lessons > 0 then
    v_progress := least(
      100,
      greatest(0, round((v_completed_count::numeric / v_total_lessons) * 100))
    );
  else
    v_progress := 0;
  end if;
  v_status := case when v_progress >= 100 then 'completed' else 'active' end;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.enrollments set
    progress_percent = v_progress,
    status = v_status,
    updated_at = v_now,
    last_lesson_id = case when p_completed then v_lesson_id else last_lesson_id end
  where id = v_enrollment_id;
  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object(
    'progressPercent', v_progress,
    'status', v_status,
    'completedLessonCount', v_completed_count,
    'totalLessonCount', v_total_lessons
  );
end;
$function$;

create or replace function public.send_course_message(
  p_course_id text,
  p_student_id text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course_id text;
  v_student_id text;
  v_body text;
  v_course public.courses%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_is_teacher boolean;
  v_sender_name text;
  v_student_name text;
  v_recipient text;
  v_message_id text := gen_random_uuid()::text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before sending a message.' using errcode = 'P0001';
  end if;

  v_course_id := btrim(coalesce(p_course_id, ''));
  if length(v_course_id) < 3 or length(v_course_id) > 160 then
    raise exception 'A valid course id is required.' using errcode = 'P0001';
  end if;

  v_student_id := btrim(coalesce(p_student_id, ''));
  if length(v_student_id) < 3 or length(v_student_id) > 160 then
    raise exception 'A valid student id is required.' using errcode = 'P0001';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if length(v_body) < 1 then
    raise exception 'Message cannot be empty.' using errcode = 'P0001';
  end if;
  v_body := left(v_body, 2000);

  select * into v_course
  from public.courses
  where id = v_course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;

  v_is_teacher := v_course.owner_id = v_uid;
  if not v_is_teacher and v_uid <> v_student_id then
    raise exception 'You can only send messages in your own thread.'
      using errcode = 'P0001';
  end if;
  if v_is_teacher and v_student_id = v_uid then
    raise exception 'You cannot message yourself.' using errcode = 'P0001';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = v_student_id || '__' || v_course_id;
  if not found then
    raise exception 'Only enrolled students can use course messages.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_student_id or v_enrollment.course_id <> v_course_id then
    raise exception 'This enrollment does not match the thread.' using errcode = 'P0001';
  end if;
  if v_enrollment.status not in ('active', 'completed') then
    raise exception 'This enrollment cannot send messages.' using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('course_msg_' || v_uid, 30, 3600000);

  select nullif(btrim(coalesce(display_name, '')), '') into v_sender_name
  from public.users where uid = v_uid;
  v_sender_name := coalesce(
    v_sender_name,
    case when v_is_teacher then 'Your teacher' else 'Skillset member' end
  );

  select nullif(btrim(coalesce(display_name, '')), '') into v_student_name
  from public.users where uid = v_student_id;
  v_student_name := coalesce(v_student_name, 'Skillset member');

  insert into public.course_messages
    (id, course_id, course_title, student_id, student_name, teacher_id, sender_id, body, created_at)
  values (
    v_message_id, v_course_id, coalesce(v_course.title, ''), v_student_id,
    v_student_name, v_course.owner_id, v_uid, v_body, v_now
  );

  v_recipient := case when v_is_teacher then v_student_id else v_course.owner_id end;
  if v_recipient is not null and v_recipient <> v_uid then
    begin
      insert into public.notifications
        (notification_id, user_id, type, title, body, link, actor_name, read, created_at)
      values (
        gen_random_uuid()::text,
        v_recipient,
        'course_message',
        case when v_is_teacher
          then 'New message from your teacher'
          else 'New student message' end,
        v_sender_name || ': ' || left(v_body, 140),
        case when v_is_teacher
          then case when coalesce(v_course.slug, '') <> ''
            then '/learn/courses/' || v_course.slug
            else '/learn' end
          else '/teach/messages' end,
        v_sender_name,
        false,
        v_now
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('success', true, 'messageId', v_message_id);
end;
$function$;

create or replace function public.submit_course_review(
  p_course_id text,
  p_rating integer,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course_id text;
  v_rating integer;
  v_body text;
  v_course public.courses%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_prev public.course_reviews%rowtype;
  v_has_prev boolean := false;
  v_prev_rating integer := 0;
  v_current_sum integer;
  v_current_count integer;
  v_rating_sum integer;
  v_rating_count integer;
  v_rating_average numeric;
  v_author_name text;
  v_owner_display text;
  v_review_id text;
  v_enrollment_id text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before reviewing a course.' using errcode = 'P0001';
  end if;

  v_course_id := btrim(coalesce(p_course_id, ''));
  if length(v_course_id) < 3 or length(v_course_id) > 160 then
    raise exception 'A valid course id is required.' using errcode = 'P0001';
  end if;

  v_rating := round(coalesce(p_rating, 0));
  if v_rating < 1 or v_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = 'P0001';
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is not null then
    v_body := left(v_body, 1200);
    if length(v_body) < 3 then
      raise exception 'Review text must be at least 3 characters when provided.'
        using errcode = 'P0001';
    end if;
  end if;

  perform public.enforce_rate_limit(
    'course_review_' || v_course_id || '_' || v_uid,
    20,
    3600000
  );

  v_review_id := v_course_id || '__' || v_uid;
  v_enrollment_id := v_uid || '__' || v_course_id;

  select * into v_course
  from public.courses
  where id = v_course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;
  if v_course.status <> 'published' then
    raise exception 'Only published courses can receive reviews.' using errcode = 'P0001';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = v_enrollment_id;
  if not found then
    raise exception 'Enroll in this course before leaving a review.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid or v_enrollment.course_id <> v_course_id then
    raise exception 'You can only review courses attached to your account.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status not in ('active', 'completed') then
    raise exception 'This enrollment cannot leave a review.' using errcode = 'P0001';
  end if;
  if coalesce(v_enrollment.progress_percent, 0) < 50 then
    raise exception 'Complete at least 50%% of the course before leaving a review.'
      using errcode = 'P0001';
  end if;

  select * into v_prev
  from public.course_reviews
  where id = v_review_id;
  v_has_prev := found;
  if v_has_prev then
    v_prev_rating := round(coalesce(v_prev.rating, 0));
  end if;

  v_current_sum := coalesce(
    v_course.rating_sum,
    round(coalesce(v_course.rating_average, 0) * coalesce(v_course.rating_count, 0))
  );
  v_current_count := coalesce(v_course.rating_count, 0);
  if v_has_prev then
    v_rating_sum := v_current_sum - v_prev_rating + v_rating;
    v_rating_count := greatest(1, v_current_count);
  else
    v_rating_sum := v_current_sum + v_rating;
    v_rating_count := v_current_count + 1;
  end if;
  v_rating_average := round((v_rating_sum::numeric / v_rating_count) * 10) / 10;

  select nullif(btrim(coalesce(display_name, '')), '') into v_owner_display
  from public.users where uid = v_uid;
  v_author_name := coalesce(v_owner_display, 'Skillset learner');

  insert into public.course_reviews
    (id, course_id, author_name, rating, body, status, created_at, updated_at)
  values (
    v_review_id, v_course_id, v_author_name, v_rating, v_body, 'published',
    case when v_has_prev then v_prev.created_at else v_now end,
    v_now
  )
  on conflict (id) do update set
    author_name = excluded.author_name,
    rating = excluded.rating,
    body = excluded.body,
    status = 'published',
    updated_at = v_now;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.courses set
    rating_average = v_rating_average,
    rating_count = v_rating_count,
    rating_sum = v_rating_sum,
    review_count = v_rating_count,
    updated_at = v_now
  where id = v_course_id;
  perform set_config('skillset.trusted_write', 'off', true);

  if v_course.owner_id is not null and v_course.owner_id <> v_uid then
    begin
      insert into public.notifications
        (notification_id, user_id, type, title, body, link, actor_name, read, created_at)
      values (
        gen_random_uuid()::text,
        v_course.owner_id,
        'course_review',
        'New ' || v_rating || '-star review',
        v_author_name || ' reviewed '
          || coalesce(nullif(v_course.title, ''), 'your course') || '.',
        case when coalesce(v_course.slug, '') <> ''
          then '/courses/' || v_course.slug
          else '/teach' end,
        v_author_name,
        false,
        v_now
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'reviewId', v_review_id,
    'ratingAverage', v_rating_average,
    'ratingCount', v_rating_count
  );
end;
$function$;

revoke execute on function public.create_free_course_enrollment(text)
  from public, anon;
grant execute on function public.create_free_course_enrollment(text)
  to authenticated, service_role;

revoke execute on function public.request_account_action(text)
  from public, anon;
grant execute on function public.request_account_action(text)
  to authenticated, service_role;

revoke execute on function public.issue_skillset_certificate(text, text)
  from public, anon;
grant execute on function public.issue_skillset_certificate(text, text)
  to authenticated;

revoke execute on function public.verify_skillset_certificate(text, text)
  from public;
grant execute on function public.verify_skillset_certificate(text, text)
  to anon, authenticated;

revoke execute on function public.record_lesson_progress(text, text, boolean)
  from public, anon;
grant execute on function public.record_lesson_progress(text, text, boolean)
  to authenticated;

revoke execute on function public.send_course_message(text, text, text)
  from public, anon;
grant execute on function public.send_course_message(text, text, text)
  to authenticated, service_role;

revoke execute on function public.submit_course_review(text, integer, text)
  from public, anon;
grant execute on function public.submit_course_review(text, integer, text)
  to authenticated;

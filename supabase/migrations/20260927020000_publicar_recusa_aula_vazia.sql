-- Publishing refuses a course with an empty lesson.
--
-- The studio already disables Publish while a lesson has no video, text or
-- file (the "Lesson content" readiness item), but the RPC only counted
-- lessons, so a direct call could publish and sell a course whose lessons
-- open to an empty player. The check below mirrors the studio rule.
--
-- Body of 20260915010000 (the latest definition), with one addition right
-- after the module/lesson count. The activation-fee gate is unchanged.
--
-- Same signature: create or replace keeps owner, grants and comment.

CREATE OR REPLACE FUNCTION public.publish_teacher_course(p_course_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_conn_acct text;
  v_charges boolean;
  v_payouts boolean;
  v_verif text;
  c public.courses%rowtype;
  v_module_count integer;
  v_lesson_count integer;
  -- A whole http(s) URL, as close to getSafeExternalUrl (new URL() with an
  -- http/https scheme) as a regex gets: optional user info, a hostname of
  -- dot-separated labels (localhost and IPv4 included; IDN letters as far as
  -- the database locale's [:alnum:] reaches) or a bracketed
  -- IPv6, an optional port up to 65535, then an optional path/query/fragment.
  -- Surrounding whitespace is allowed because the app trims. Rejects
  -- "https://%", "https://", a host with spaces and non-http schemes.
  v_link_pattern constant text :=
    '^[[:space:]]*https?://([^[:space:]/?#@]*@)?'
    || '([[:alnum:]_-]+(\.[[:alnum:]_-]+)*\.?|\[[0-9a-f:.]+\])'
    || '(:([0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?'
    || '([/?#].*)?[[:space:]]*$';
BEGIN
  PERFORM public.require_strong_session();
  if v_uid is null then
    raise exception 'Sign in before publishing a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at,
         u.stripe_connected_account_id,
         u.stripe_connect_charges_enabled,
         u.stripe_connect_payouts_enabled,
         u.creator_verification_status
    into v_roles, v_accepted, v_conn_acct, v_charges, v_payouts, v_verif
  from public.users u
  where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before publishing courses.';
  end if;

  if coalesce((
       select (ps.value #>> '{}')::boolean
       from public.platform_settings ps
       where ps.key = 'require_creator_verification'
     ), false)
     and coalesce(v_verif, 'none') <> 'approved' then
    raise exception 'Professional verification must be approved before publishing a course.';
  end if;

  select * into c
  from public.courses
  where id = p_course_id
  for update;

  if c.id is null then
    raise exception 'Course not found.';
  end if;
  if c.owner_id <> v_uid then
    raise exception 'Only the course owner can publish it.';
  end if;
  if c.status = 'published' then
    return jsonb_build_object('success', true, 'status', 'published', 'alreadyPublished', true);
  end if;
  if c.status not in ('draft', 'in_review', 'needs_changes', 'inactive') then
    raise exception 'This course cannot be published right now.';
  end if;

  -- Account-level gate, deliberately not limited to paid courses: the fee
  -- activates the storefront itself, so a free first course pays it too. It
  -- follows ownership and the already-published return so this remains an
  -- idempotent publish RPC after the gate is enabled. Same predicate as the
  -- draft trigger, video upload, coupons, access grants and checkout: a paid
  -- fee, a ready waiver or an admin session lets the creator through.
  if public.creator_activation_blocked() then
    raise exception 'Pay the one-time activation fee before publishing your first course.';
  end if;

  if char_length(btrim(coalesce(c.title, ''))) < 3 or char_length(c.title) > 120 then
    raise exception 'Add a course title before publishing.';
  end if;
  if char_length(btrim(coalesce(c.summary, ''))) < 20 or char_length(c.summary) > 1200 then
    raise exception 'Add a course summary (at least 20 characters) before publishing.';
  end if;
  if char_length(btrim(coalesce(c.category, ''))) < 2 or char_length(c.category) > 80 then
    raise exception 'Choose a course category before publishing.';
  end if;

  v_module_count := jsonb_array_length(coalesce(c.modules, '[]'::jsonb));
  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m;
  if v_module_count < 1 or v_lesson_count < 1 then
    raise exception 'Add at least one module with a lesson before publishing.';
  end if;

  -- Every lesson must have something the student can open. Same rule as the
  -- studio (getLessonIdsWithMedia in src/domain/course-readiness.ts): an
  -- uploaded video or recording, an attached file, an http(s) link (a
  -- YouTube/Vimeo embed or an "Open resource" button in the player), the
  -- lesson text, or the legacy description. Text and link live in
  -- course_lesson_content (the public modules copy is stripped); the inline
  -- keys are read too, for a row written before that split.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where not (
      coalesce(l->>'description', '') ~ '[^[:space:]]'
      or coalesce(l->>'contentText', '') ~ '[^[:space:]]'
      or coalesce(l->>'externalUrl', '') ~* v_link_pattern
      or exists (
        select 1
        from public.course_lesson_content lc
        where lc.lesson_id = l->>'id'
          and lc.course_id = c.id
          and (
            coalesce(lc.content_text, '') ~ '[^[:space:]]'
            or coalesce(lc.external_url, '') ~* v_link_pattern
          )
      )
      or exists (
        select 1
        from public.course_assets a
        where a.course_id = c.id
          and a.lesson_id = l->>'id'
          and a.kind in ('lesson_video', 'live_recording', 'lesson_material')
      )
    )
  ) then
    raise exception 'Every lesson needs a video, text or a file before publishing.';
  end if;

  if c.free_preview_lesson_id is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where l->>'id' = c.free_preview_lesson_id
  ) then
    raise exception 'Free preview lesson must belong to this course.';
  end if;

  if coalesce(c.payment_type, 'one_time') <> 'free' then
    if coalesce(c.payment_type, 'one_time') not in (
      'one_time',
      'subscription_monthly',
      'subscription_yearly'
    ) then
      raise exception 'Choose a valid payment type before publishing.';
    end if;
    if coalesce(c.price_amount_minor, 0) <= 0 then
      raise exception 'Set a price before publishing a paid course.';
    end if;
    if v_conn_acct is null
       or not coalesce(v_charges, false)
       or not coalesce(v_payouts, false) then
      raise exception 'Finish Stripe payout onboarding before publishing a paid course.';
    end if;
  end if;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.courses
    set status = 'published', review_note = null, updated_at = now()
  where id = p_course_id;
  perform set_config('skillset.trusted_write', 'off', true);

  perform public.log_audit_event(
    p_action => 'COURSE_PUBLISHED_BY_CREATOR',
    p_actor_id => v_uid,
    p_actor_email => coalesce(
      (select email from public.users where uid = v_uid),
      v_uid
    ),
    p_target_type => 'course',
    p_target_id => p_course_id,
    p_summary => 'Creator published course ' || p_course_id,
    p_metadata => jsonb_build_object(
      'title', c.title,
      'paymentType', c.payment_type
    )
  );

  return jsonb_build_object('success', true, 'status', 'published');
end;
$function$;

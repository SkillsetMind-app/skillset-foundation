-- Guard: a paid course cannot be submitted for review (and thus reach the
-- catalog) unless its owner has a payout-ready Stripe Connect account.
--
-- Without this, a teacher could ship a paid course to the catalog while their
-- Connect onboarding was incomplete. The course would render buyable, but every
-- purchase would fail at checkout, which already blocks on exactly this
-- condition (connected account present + charges_enabled + payouts_enabled).
-- Enforcing it at submission stops a dead paid course from ever shipping.
--
-- Only the paid-course branch is affected; free courses are untouched. Applied
-- to prod via MCP on 2026-07-07 and versioned here to keep schema in git.

CREATE OR REPLACE FUNCTION public.submit_teacher_course_for_review(p_course_id text)
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
  c public.courses%rowtype;
  v_module_count integer;
  v_lesson_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in before submitting a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at,
         u.stripe_connected_account_id,
         u.stripe_connect_charges_enabled,
         u.stripe_connect_payouts_enabled
    into v_roles, v_accepted, v_conn_acct, v_charges, v_payouts
  from public.users u where u.uid = v_uid;
  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before submitting courses.';
  end if;

  select * into c from public.courses where id = p_course_id;
  if c.id is null then
    raise exception 'Course not found.';
  end if;
  if c.owner_id <> v_uid then
    raise exception 'Only the course owner can submit it.';
  end if;
  if c.status not in ('draft', 'needs_changes', 'inactive') then
    raise exception 'This course cannot be submitted for review right now.';
  end if;

  -- validateCourseReadyForReview
  if char_length(btrim(coalesce(c.title,''))) < 3 or char_length(c.title) > 120 then
    raise exception 'Add a course title before submitting.';
  end if;
  if char_length(btrim(coalesce(c.summary,''))) < 20 or char_length(c.summary) > 1200 then
    raise exception 'Add a course summary (at least 20 characters) before submitting.';
  end if;
  if char_length(btrim(coalesce(c.category,''))) < 2 or char_length(c.category) > 80 then
    raise exception 'Choose a course category before submitting.';
  end if;

  v_module_count := jsonb_array_length(coalesce(c.modules, '[]'::jsonb));
  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m;
  if v_module_count < 1 or v_lesson_count < 1 then
    raise exception 'Add at least one module with a lesson before submitting.';
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
    if coalesce(c.payment_type, 'one_time') not in ('one_time','subscription_monthly','subscription_yearly') then
      raise exception 'Choose a valid payment type before submitting.';
    end if;
    if coalesce(c.price_amount_minor, 0) <= 0 then
      raise exception 'Set a price before submitting a paid course.';
    end if;
    -- A paid course whose owner has no payout-ready Stripe Connect account would
    -- reach the catalog buyable-but-broken: checkout blocks every purchase on
    -- exactly this condition (connected account present + charges + payouts
    -- enabled). Stop it at submission so a dead paid course never ships.
    if v_conn_acct is null
       or not coalesce(v_charges, false)
       or not coalesce(v_payouts, false) then
      raise exception 'Finish Stripe payout onboarding before submitting a paid course.';
    end if;
  end if;

  -- Frozen column status requires the trusted-write flag.
  perform set_config('skillset.trusted_write', 'on', true);
  update public.courses
    set status = 'in_review', review_note = null, updated_at = now()
  where id = p_course_id;
  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object('success', true);
end;
$function$;

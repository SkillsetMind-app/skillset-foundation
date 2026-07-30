-- One-time storefront activation fee, charged once per creator. Publishing the
-- first course is the gate. This does NOT replace the Free plan's 10% per-sale
-- commission and does not introduce a subscription: it is a single charge, and
-- the creator pays nothing monthly afterwards.
--
-- The gate lives in SQL, not in TypeScript, because publish_teacher_course is an
-- RPC the browser client calls directly (src/lib/data/teacher-courses.ts:104).
-- A check in the app layer would be bypassable with a raw supabase-js call.

alter table public.users
  add column if not exists activation_fee_paid_at timestamptz;

comment on column public.users.activation_fee_paid_at is
  'When the one-time storefront activation fee was paid. Set by the Stripe webhook on a checkout session with metadata.purpose = skillset_activation_fee. Null = unpaid.';

-- The single switch for the whole feature. Seeded FALSE on purpose: the Stripe
-- Price ships as a placeholder, so enabling the gate before the real price_...
-- exists would block every publish with no way to pay. Flip to true only after
-- ACTIVATION_FEE_STRIPE_PRICE_ID in src/data/plans.ts holds a real Price:
--   update public.platform_settings set value = 'true'::jsonb, updated_at = now()
--    where key = 'require_activation_fee';
insert into public.platform_settings (key, value)
values ('require_activation_fee', 'false'::jsonb)
on conflict (key) do nothing;

-- Replaces 20260716000300_direct_creator_publication.sql. Only change: the
-- activation-fee gate and the column it reads. Every other check is byte-for-byte
-- the previous definition.
create or replace function public.publish_teacher_course(p_course_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_conn_acct text;
  v_charges boolean;
  v_payouts boolean;
  v_verif text;
  v_activation_paid timestamptz;
  c public.courses%rowtype;
  v_module_count integer;
  v_lesson_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in before publishing a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at,
         u.stripe_connected_account_id,
         u.stripe_connect_charges_enabled,
         u.stripe_connect_payouts_enabled,
         u.creator_verification_status,
         u.activation_fee_paid_at
    into v_roles, v_accepted, v_conn_acct, v_charges, v_payouts, v_verif,
         v_activation_paid
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

  -- Account-level gate, deliberately not limited to paid courses: the fee
  -- activates the storefront itself, so a free first course pays it too.
  if coalesce((
       select (ps.value #>> '{}')::boolean
       from public.platform_settings ps
       where ps.key = 'require_activation_fee'
     ), false)
     and v_activation_paid is null then
    raise exception 'Pay the one-time activation fee before publishing your first course.';
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

-- create or replace preserves privileges, but the source migration states them
-- explicitly and this file is the new source of truth for the function.
revoke execute on function public.publish_teacher_course(text)
  from public, anon;
grant execute on function public.publish_teacher_course(text)
  to authenticated, service_role;

-- Reproduce the live teacher-course RPC surface on a clean database.
-- Sources: live pg_get_functiondef snapshots (2026-07-07 and 2026-07-15)
-- plus the SQL migration originally applied to the live project on 2026-07-04.

create extension if not exists unaccent with schema extensions;

create or replace function public.course_title_key(p_title text)
returns text
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select left(
    regexp_replace(
      regexp_replace(
        lower(extensions.unaccent(btrim(coalesce(p_title, '')))),
        '[^a-z0-9]+', '-', 'g'
      ),
      '(^-+|-+$)', '', 'g'
    ),
    140
  );
$function$;

create or replace function public.platform_fee_bps_for_plan(p_plan text)
returns integer
language sql
immutable
as $function$
  select case p_plan
    when 'free' then 800
    when 'starter' then 400
    when 'pro' then 100
    when 'plus' then 0
    else 800
  end;
$function$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.users u
    where u.uid = (select auth.uid())::text
      and u.roles ? 'admin'
  );
$function$;

create or replace function public.log_audit_event(
  p_action text,
  p_actor_id text,
  p_actor_email text,
  p_target_type text,
  p_target_id text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.audit_log
    (id, action, actor_id, actor_email, target_type, target_id, summary, metadata, created_at)
  values (
    gen_random_uuid()::text,
    p_action,
    p_actor_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    p_target_type,
    p_target_id,
    left(p_summary, 280),
    coalesce(p_metadata, '{}'::jsonb),
    now()
  );
exception when others then
  -- Auditing is best-effort and must not roll back the caller.
  null;
end;
$function$;

create or replace function public.create_teacher_course_draft(
  p_title text,
  p_summary text,
  p_category text,
  p_categories text[],
  p_payment_type text
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_title text := btrim(coalesce(p_title, ''));
  v_summary text := btrim(coalesce(p_summary, ''));
  v_title_key text;
  v_category text;
  v_payment_type text;
  v_price integer;
  v_fee integer;
  v_course_id text := gen_random_uuid()::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_plan text;
begin
  if v_uid is null then
    raise exception 'Sign in before creating a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at, u.current_plan_id
    into v_roles, v_accepted, v_plan
  from public.users u
  where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before creating courses.';
  end if;

  perform public.enforce_rate_limit('course_draft_create_' || v_uid, 20, 3600000);

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'Course title must be between 3 and 120 characters.';
  end if;
  if char_length(v_summary) < 20 or char_length(v_summary) > 1200 then
    raise exception 'Course summary must be between 20 and 1200 characters.';
  end if;

  v_title_key := public.course_title_key(v_title);
  if char_length(v_title_key) < 3 then
    raise exception 'Course title is not specific enough.';
  end if;

  v_category := coalesce(
    nullif(btrim(coalesce(p_categories[1], '')), ''),
    nullif(left(btrim(coalesce(p_category, '')), 80), '')
  );
  if v_category is null then
    raise exception 'Choose at least one marketplace category.';
  end if;

  v_payment_type := nullif(btrim(coalesce(p_payment_type, '')), '');
  if v_payment_type is null or v_payment_type not in (
    'free',
    'one_time',
    'subscription_monthly',
    'subscription_yearly'
  ) then
    raise exception 'Choose a valid payment type before creating a course.';
  end if;
  v_price := case when v_payment_type = 'free' then 0 else null end;
  v_fee := public.platform_fee_bps_for_plan(v_plan);

  if exists (select 1 from public.courses c where c.title_key = v_title_key) then
    raise exception 'A course with this title already exists. Choose a more specific name.';
  end if;

  insert into public.courses (
    id, owner_id, title, title_key, summary, category, categories,
    learning_outcomes, status, modules, lesson_count,
    price_amount_minor, currency, payment_type,
    installments_enabled, installments_max, platform_fee_bps,
    drip_strategy, drip_interval_days, free_preview_lesson_id
  ) values (
    v_course_id, v_uid, v_title, v_title_key, v_summary, v_category,
    coalesce(p_categories, '{}'),
    '{}', 'draft', '[]'::jsonb, 0,
    v_price, 'USD', v_payment_type,
    false, null, v_fee,
    'instant', 1, null
  );

  insert into public.course_title_keys (title_key)
  values (v_title_key)
  on conflict (title_key) do nothing;

  return v_course_id;
end;
$function$;

create or replace function public.update_teacher_course_builder(
  p_course_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_plan text;
  v_owner text;
  v_status text;
  v_current_key text;
  v_current_title text;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_summary text := btrim(coalesce(p_payload->>'summary', ''));
  v_title_key text;
  v_categories text[];
  v_category text;
  v_outcomes text[];
  v_modules jsonb;
  v_lesson_count integer;
  v_payment_type text;
  v_price integer;
  v_currency text;
  v_inst_enabled boolean;
  v_inst_max integer;
  v_drip_strategy text;
  v_drip_days integer;
  v_free text;
  v_fee integer;
  v_members_theme text;
  v_community boolean := coalesce((p_payload->'communityEnabled') = 'true'::jsonb, false);
begin
  if v_uid is null then
    raise exception 'Sign in before saving a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at, u.current_plan_id
    into v_roles, v_accepted, v_plan
  from public.users u where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before saving courses.';
  end if;

  select c.owner_id, c.status, c.title_key, c.title
    into v_owner, v_status, v_current_key, v_current_title
  from public.courses c where c.id = p_course_id;

  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can save it.';
  end if;
  if v_status not in ('draft', 'needs_changes', 'published', 'inactive') then
    raise exception 'This course status cannot be edited from the builder.';
  end if;

  v_title_key := public.course_title_key(v_title);
  if char_length(v_title_key) < 3 then
    raise exception 'Course title is not specific enough.';
  end if;

  v_categories := coalesce((
    select array_agg(elem #>> '{}' order by ord)
    from jsonb_array_elements(coalesce(p_payload->'categories', '[]'::jsonb))
         with ordinality as t(elem, ord)
    where jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> ''
  ), '{}');

  v_category := coalesce(
    v_categories[1],
    nullif(left(btrim(coalesce(p_payload->>'category', '')), 80), '')
  );
  if v_category is null
     or char_length(v_category) < 2
     or char_length(v_category) > 80 then
    raise exception 'Choose a valid course category.';
  end if;

  v_outcomes := coalesce((
    select array_agg(x order by ord)
    from (
      select left(btrim(elem #>> '{}'), 120) as x, ord
      from jsonb_array_elements(coalesce(p_payload->'learningOutcomes', '[]'::jsonb))
           with ordinality as t(elem, ord)
      where jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> ''
      order by ord
      limit 8
    ) s
  ), '{}');

  v_modules := coalesce(p_payload->'modules', '[]'::jsonb);
  if jsonb_typeof(v_modules) <> 'array' then
    v_modules := '[]'::jsonb;
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(v_modules) m;

  v_payment_type := case
    when p_payload->>'paymentType' in ('free', 'one_time', 'subscription_monthly', 'subscription_yearly')
      then p_payload->>'paymentType'
    else 'one_time'
  end;

  v_price := case
    when v_payment_type = 'free' then 0
    when jsonb_typeof(p_payload->'priceAmountMinor') = 'number'
      then round((p_payload->>'priceAmountMinor')::numeric)::int
    else null
  end;
  if v_price is not null and v_price < 0 then
    raise exception 'Price cannot be negative.';
  end if;

  v_currency := upper(nullif(btrim(coalesce(p_payload->>'currency', '')), ''));
  if v_currency is null or char_length(v_currency) <> 3 then
    v_currency := 'USD';
  end if;

  v_inst_enabled := v_payment_type = 'one_time'
    and (p_payload->'installmentsEnabled') = 'true'::jsonb;
  v_inst_max := case when v_inst_enabled then
    least(36, greatest(1, coalesce(
      case when jsonb_typeof(p_payload->'installmentsMax') = 'number'
        then round((p_payload->>'installmentsMax')::numeric)::int else null end, 12)))
    else null end;

  v_drip_strategy := coalesce(
    nullif(btrim(coalesce(p_payload->>'dripStrategy', '')), ''),
    'instant'
  );
  v_drip_days := greatest(1, coalesce(
    case when jsonb_typeof(p_payload->'dripIntervalDays') = 'number'
      then round((p_payload->>'dripIntervalDays')::numeric)::int else null end,
    1
  ));

  v_free := nullif(btrim(coalesce(p_payload->>'freePreviewLessonId', '')), '');
  if v_free is not null and not exists (
    select 1
    from jsonb_array_elements(v_modules) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where l->>'id' = v_free
  ) then
    raise exception 'Free preview lesson must belong to this course.';
  end if;

  v_members_theme := case when p_payload->>'membersTheme' in ('light', 'dark')
    then p_payload->>'membersTheme' else null end;

  v_fee := public.platform_fee_bps_for_plan(v_plan);

  if v_title_key <> coalesce(v_current_key, public.course_title_key(v_current_title)) then
    if exists (
      select 1 from public.courses c
      where c.title_key = v_title_key and c.id <> p_course_id
    ) then
      raise exception 'A course with this title already exists. Choose a more specific name.';
    end if;
    insert into public.course_title_keys (title_key) values (v_title_key)
    on conflict (title_key) do nothing;
    if v_current_key is not null and v_current_key <> v_title_key
       and not exists (
         select 1 from public.courses c
         where c.title_key = v_current_key and c.id <> p_course_id
       ) then
      delete from public.course_title_keys where title_key = v_current_key;
    end if;
  end if;

  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses set
    title = v_title,
    title_key = v_title_key,
    summary = v_summary,
    category = v_category,
    categories = v_categories,
    learning_outcomes = v_outcomes,
    modules = v_modules,
    lesson_count = v_lesson_count,
    price_amount_minor = v_price,
    currency = v_currency,
    payment_type = v_payment_type,
    installments_enabled = v_inst_enabled,
    installments_max = v_inst_max,
    platform_fee_bps = v_fee,
    drip_strategy = v_drip_strategy,
    drip_interval_days = v_drip_days,
    free_preview_lesson_id = v_free,
    members_theme = v_members_theme,
    members_cover_asset_id = nullif(
      btrim(left(coalesce(p_payload->>'membersCoverAssetId', ''), 160)),
      ''
    ),
    members_title = nullif(
      btrim(left(coalesce(p_payload->>'membersTitle', ''), 80)),
      ''
    ),
    members_subtitle = nullif(
      btrim(left(coalesce(p_payload->>'membersSubtitle', ''), 160)),
      ''
    ),
    members_description = nullif(
      btrim(left(coalesce(p_payload->>'membersDescription', ''), 2000)),
      ''
    ),
    community_enabled = v_community,
    updated_at = now()
  where id = p_course_id;

  perform set_config('skillset.trusted_write', 'off', true);

  insert into public.course_lesson_content
    (lesson_id, course_id, content_text, external_url, created_at, updated_at)
  select
    l->>'id',
    p_course_id,
    nullif(l->>'contentText', ''),
    nullif(l->>'externalUrl', ''),
    now(),
    now()
  from jsonb_array_elements(v_modules) m,
       jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
  where coalesce(l->>'id', '') <> ''
  on conflict (lesson_id) do update set
    course_id = excluded.course_id,
    content_text = excluded.content_text,
    external_url = excluded.external_url,
    updated_at = now();

  delete from public.course_lesson_content
  where course_id = p_course_id
    and lesson_id not in (
      select l->>'id'
      from jsonb_array_elements(v_modules) m,
           jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      where coalesce(l->>'id', '') <> ''
    );

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.delete_teacher_course_draft(p_course_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_status text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'Sign in before deleting a course.';
  end if;

  select owner_id, status, title_key into v_owner, v_status, v_key
  from public.courses where id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can delete it.';
  end if;
  if v_status not in ('draft', 'needs_changes') then
    raise exception 'Only a draft or needs-changes course can be deleted.';
  end if;

  delete from public.course_lesson_content where course_id = p_course_id;
  if v_key is not null then
    delete from public.course_title_keys where title_key = v_key;
  end if;
  delete from public.courses where id = p_course_id;

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.delete_course_as_admin(p_course_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_title text;
  v_key text;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'Only an administrator can delete this course.';
  end if;

  select owner_id, title, title_key into v_owner, v_title, v_key
  from public.courses where id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;

  if exists (select 1 from public.enrollments where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has enrollments.';
  end if;
  if exists (select 1 from public.orders where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has orders.';
  end if;

  delete from public.course_lesson_content where course_id = p_course_id;
  if v_key is not null then
    delete from public.course_title_keys where title_key = v_key;
  end if;
  delete from public.courses where id = p_course_id;

  begin
    perform public.log_audit_event(
      p_action => 'COURSE_DELETED_BY_ADMIN',
      p_actor_email => coalesce(
        (select email from public.users where uid = v_uid),
        v_uid
      ),
      p_actor_id => v_uid,
      p_metadata => jsonb_build_object('title', v_title, 'ownerId', v_owner),
      p_summary => 'Admin deleted course ' || p_course_id,
      p_target_id => p_course_id,
      p_target_type => 'course'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true);
end;
$function$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

revoke execute on function public.log_audit_event(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.log_audit_event(text, text, text, text, text, text, jsonb)
  to authenticated, service_role;

revoke execute on function public.create_teacher_course_draft(text, text, text, text[], text)
  from public, anon;
grant execute on function public.create_teacher_course_draft(text, text, text, text[], text)
  to authenticated, service_role;

revoke execute on function public.update_teacher_course_builder(text, jsonb)
  from public, anon;
grant execute on function public.update_teacher_course_builder(text, jsonb)
  to authenticated, service_role;

revoke execute on function public.delete_teacher_course_draft(text)
  from public, anon;
grant execute on function public.delete_teacher_course_draft(text)
  to authenticated, service_role;

revoke execute on function public.delete_course_as_admin(text)
  from public, anon;
grant execute on function public.delete_course_as_admin(text)
  to authenticated, service_role;

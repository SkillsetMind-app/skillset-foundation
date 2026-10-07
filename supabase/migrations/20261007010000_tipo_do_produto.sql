-- O tipo do produto passa a ficar gravado, e publicar depende dele.
--
-- A tela de criacao oferecia formatos (curso, comunidade, evento...), mas o
-- escolhido nao ia para o banco: depois de criar, todo produto era "curso".
-- Uma comunidade ou um evento ao vivo precisavam de modulo e aula para
-- publicar, e um e-book era tratado como curso.
--
-- 1. courses.product_format: course | community | live_event | ebook.
-- 2. Backfill pelo que o banco ja guarda.
-- 3. create_teacher_course_draft ganha a versao que grava o tipo e, para
--    curso e e-book, ja cria o primeiro modulo com a primeira aula.
-- 4. publish_teacher_course cobra o conteudo de cada tipo:
--    - course: ao menos um modulo com uma aula (como antes);
--    - community: nada (aulas opcionais);
--    - live_event: uma sessao agendada em course_events;
--    - ebook: ao menos um arquivo (lesson_material) numa aula do produto.
--    Em todos, aula que existe continua precisando de conteudo.
--
-- Idempotente: coluna e restricao so entram se faltarem, o backfill so mexe
-- em linha ainda no padrao, e as funcoes sao create or replace.

alter table public.courses
  add column if not exists product_format text not null default 'course';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_product_format_check'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
      add constraint courses_product_format_check
      check (product_format in ('course', 'community', 'live_event', 'ebook'));
  end if;
end $$;

comment on column public.courses.product_format is
  'O que o produto entrega: course, community, live_event ou ebook. Escolhido na criacao; decide o que publish_teacher_course cobra.';

-- Backfill. O banco nunca gravou o tipo, entao vale so o sinal que existe:
-- - evento: o fluxo antigo criava o produto e uma sessao em course_events, sem
--   aula (e por isso nao publicava). Curso com aula e sessao ao vivo continua
--   curso.
-- - comunidade: o fluxo antigo criava assinatura com a comunidade ligada.
-- O resto fica course, que e a regra antiga: errar para curso nao baixa a
-- exigencia de ninguem.
do $$
begin
  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses c
     set product_format = 'live_event'
   where c.product_format = 'course'
     and exists (select 1 from public.course_events e where e.course_id = c.id)
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m,
            jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
     );

  update public.courses c
     set product_format = 'community'
   where c.product_format = 'course'
     and coalesce(c.community_enabled, false)
     and c.payment_type in ('subscription_monthly', 'subscription_yearly');

  perform set_config('skillset.trusted_write', 'off', true);
end $$;

-- Criacao com tipo. Chama a versao de cinco argumentos (titulo, URL livre,
-- limite de criacao, taxa do plano, trava de ativacao) e so completa a linha:
-- tipo, comunidade (sempre ligada no tipo comunidade) e o primeiro modulo.
-- Os titulos do modulo e da aula vem do cliente, no idioma da pessoa.
create or replace function public.create_teacher_course_draft(
  p_title text,
  p_summary text,
  p_category text,
  p_categories text[],
  p_payment_type text,
  p_community_enabled boolean,
  p_product_format text,
  p_module_title text,
  p_lesson_title text
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_format text := coalesce(nullif(btrim(coalesce(p_product_format, '')), ''), 'course');
  v_module_title text := left(btrim(coalesce(p_module_title, '')), 120);
  v_lesson_title text := left(btrim(coalesce(p_lesson_title, '')), 120);
  v_modules jsonb := '[]'::jsonb;
  v_course_id text;
begin
  -- A mesma trava de sessao de toda RPC de quem esta logado
  -- (20260910030000): conta suspensa ou sessao revogada nao cria.
  perform public.require_strong_session();
  if v_format not in ('course', 'community', 'live_event', 'ebook') then
    raise exception 'Choose a valid product type.';
  end if;

  v_course_id := public.create_teacher_course_draft(
    p_title,
    p_summary,
    p_category,
    p_categories,
    p_payment_type
  );

  if v_format in ('course', 'ebook') then
    v_modules := jsonb_build_array(jsonb_build_object(
      'id', 'module-' || gen_random_uuid()::text,
      'title', coalesce(nullif(v_module_title, ''), 'Module 1'),
      'summary', null,
      'coverAssetId', null,
      'lessons', jsonb_build_array(jsonb_build_object(
        'id', 'lesson-' || gen_random_uuid()::text,
        'title', coalesce(nullif(v_lesson_title, ''), 'Lesson 1'),
        'type', case when v_format = 'ebook' then 'download' else 'video' end,
        'description', '',
        'durationMinutes', null,
        'dripDelayDays', null,
        'contentText', null,
        'externalUrl', null
      ))
    ));
  end if;

  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses
     set product_format = v_format,
         community_enabled = coalesce(p_community_enabled, false) or v_format = 'community',
         modules = v_modules,
         lesson_count = case when jsonb_array_length(v_modules) > 0 then 1 else 0 end,
         updated_at = now()
   where id = v_course_id
     and owner_id = v_uid;

  if not found then
    raise exception 'The product draft could not be initialized.';
  end if;

  perform set_config('skillset.trusted_write', 'off', true);

  return v_course_id;
end;
$function$;

revoke all on function public.create_teacher_course_draft(
  text, text, text, text[], text, boolean, text, text, text
) from public, anon;

grant execute on function public.create_teacher_course_draft(
  text, text, text, text[], text, boolean, text, text, text
) to authenticated, service_role;

-- Publicar: corpo de 20260927020000 (a definicao mais recente), com a
-- exigencia de modulo e aula trocada pela exigencia de cada tipo. A trava de
-- ativacao, a de verificacao, a de aula vazia e a de pagamento nao mudam.
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
  v_format text;
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

  -- What each product type must deliver. Same rule as the studio
  -- (getCourseReadiness in src/domain/course-readiness.ts).
  v_format := coalesce(c.product_format, 'course');
  v_module_count := jsonb_array_length(coalesce(c.modules, '[]'::jsonb));
  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m;
  if v_format = 'course' and (v_module_count < 1 or v_lesson_count < 1) then
    raise exception 'Add at least one module with a lesson before publishing.';
  end if;
  if v_format = 'live_event' and not exists (
    select 1
    from public.course_events e
    where e.course_id = c.id
      and e.status = 'scheduled'
  ) then
    raise exception 'Schedule the live session before publishing.';
  end if;
  -- The file has to sit on a lesson of the product: that lesson is where the
  -- buyer downloads it.
  if v_format = 'ebook' and not exists (
    select 1
    from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l,
         public.course_assets a
    where a.course_id = c.id
      and a.lesson_id = l->>'id'
      and a.kind = 'lesson_material'
  ) then
    raise exception 'Upload at least one file before publishing.';
  end if;

  -- Every lesson must have something the student can open. Same rule as the
  -- studio (getLessonIdsWithMedia in src/domain/course-readiness.ts): an
  -- uploaded video or recording, an attached file, an http(s) link (a
  -- YouTube/Vimeo embed or an "Open resource" button in the player), the
  -- lesson text, or the legacy description. Text and link live in
  -- course_lesson_content (the public modules copy is stripped); the inline
  -- keys are read too, for a row written before that split. Optional lessons
  -- (community, live event replay) follow the same rule once they exist.
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
      'paymentType', c.payment_type,
      'productFormat', v_format
    )
  );

  return jsonb_build_object('success', true, 'status', 'published');
end;
$function$;

-- Criador convidado com isenção da taxa montava o curso inteiro e travava no
-- Publicar.
--
-- Achado em 15/09 com a conta de teste em produção: rascunho, currículo e envio
-- de vídeo passaram (todos usam creator_activation_blocked(), que aceita taxa
-- paga, isenção pronta e admin), e a publicação recusou com "Pay the one-time
-- activation fee before publishing your first course.". publish_teacher_course
-- lia só users.activation_fee_paid_at, desde antes de a isenção existir
-- (20260730000100). A migration 20260910066500 já dizia que "o predicado é o
-- mesmo da publicação e do checkout"; na publicação não era.
--
-- Corpo de produção de 15/09 (pg_get_functiondef), com uma troca: a porta da
-- taxa passa a ser creator_activation_blocked(). Mensagem igual, para a tela
-- continuar reconhecendo "activation fee". Isenção pendente (ready_at nulo)
-- continua barrada, igual às outras portas.
--
-- Mesma assinatura: create or replace mantém dono, grants e comentário.

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

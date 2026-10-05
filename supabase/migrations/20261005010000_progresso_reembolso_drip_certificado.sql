-- Progresso do aluno: reembolso, liberacao (drip), certificado e dois detalhes.
--
-- Seis achados de uma auditoria estatica de origin/main (6a983e5). Cada funcao
-- e recriada com a MESMA assinatura, SECURITY DEFINER e search_path. CREATE OR
-- REPLACE preserva dono e grants, entao nenhum grant e reemitido aqui.
--
-- Cada corpo parte da definicao vigente:
--   record_lesson_progress, send_course_message, submit_course_review:
--     20260716000200_live_application_rpcs.sql (identicos ao snapshot de 07-21)
--   issue_skillset_certificate: 20260808150000_whitelabel_platform_brand.sql
-- mais o que blocos DO injetaram depois, e que portanto ja vive em producao:
--   - `perform public.require_strong_session();` no topo das quatro
--     (20260906020000_security_boundaries.sql);
--   - `for update` na leitura da matricula de record_lesson_progress
--     (20260913012647_rpc_locks_preserve_access_and_feature_quota.sql; o smoke
--     dela confere essa trava no corpo novo tambem).
--
-- Prova: supabase/tests/20261005010000_progresso_reembolso_drip_certificado_smoke.sql.

-- ---------------------------------------------------------------------------
-- 1. Reembolso automatico: o teto de progresso olha o PICO, que nunca desce.
-- ---------------------------------------------------------------------------
--
-- Desmarcar uma aula apaga a linha de lesson_progress e recalcula
-- progress_percent para baixo. A rota de reembolso
-- (src/app/api/payments/refunds/request/route.ts) comparava esse valor com o
-- teto: o aluno marcava as aulas (no modo sequencial, marcar e o que abre a
-- seguinte), consumia o curso, desmarcava tudo e voltava a ficar abaixo do teto.
--
-- Por que uma coluna e nao lesson_playback: playback registra aula ABERTA, que e
-- outra regra de reembolso, e o proprio cliente decide se chama
-- record_lesson_playback; nada no banco guarda o maximo ja atingido.
-- record_lesson_progress grava greatest(pico, novo); a rota le o maior dos dois.

alter table public.enrollments
  add column if not exists max_progress_percent integer not null default 0;

comment on column public.enrollments.max_progress_percent is
  'Maior progress_percent ja atingido pela matricula. So sobe (record_lesson_progress). E o que o teto do reembolso automatico compara: desmarcar aulas baixa progress_percent, nao este.';

-- Backfill com o progresso atual (o pico de quem ja desmarcou se perdeu). Roda
-- ANTES de trocar o guarda: o guarda vigente nao conhece a coluna, entao o
-- update passa sem a flag de escrita confiavel.
update public.enrollments
   set max_progress_percent = progress_percent
 where progress_percent > max_progress_percent;

-- O guarda de 20260906010000_creator_course_access.sql com a coluna nova na
-- lista. Sem isto o aluno zeraria o proprio pico pelo PostgREST:
-- enrollments_update_owner deixa ele atualizar a propria linha.
CREATE OR REPLACE FUNCTION public.enrollments_owner_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_service_role() OR public.is_admin() OR current_setting('skillset.trusted_write',true)='on' THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
    OR NEW.course_title IS DISTINCT FROM OLD.course_title OR NEW.course_category IS DISTINCT FROM OLD.course_category
    OR NEW.course_image IS DISTINCT FROM OLD.course_image OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.source IS DISTINCT FROM OLD.source OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
    OR NEW.progress_percent IS DISTINCT FROM OLD.progress_percent OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.creator_grant_id IS DISTINCT FROM OLD.creator_grant_id
    OR NEW.max_progress_percent IS DISTINCT FROM OLD.max_progress_percent THEN
    RAISE EXCEPTION 'enrollments: owners may only update last_lesson_id and updated_at';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 2. record_lesson_progress: drip, arredondamento e o pico do item 1.
-- ---------------------------------------------------------------------------
--
-- (a) Drip. A funcao nao perguntava se a aula ja foi liberada, e os ids das
--     aulas sao publicos em courses.modules: no primeiro dia o aluno marcava o
--     curso inteiro como concluido e, no modo sequencial, abria a aula N+1 so
--     marcando a N. Agora marcar uma aula fechada recusa, pela mesma
--     public.lesson_is_released que as policies de leitura usam
--     (20260915020000). Desmarcar continua livre.
-- (b) 199 de 200 aulas arredondava para 100 e virava 'completed'. Concluido e
--     so quando todas as aulas atuais estao feitas; fora isso o teto e 99.
-- (c) max_progress_percent sobe junto (item 1).

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
  perform public.require_strong_session();

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
  where id = v_enrollment_id for update;
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

  -- (a) Aula que o calendario ainda nao abriu nao pode ser concluida.
  if p_completed
     and not public.lesson_is_released(v_enrollment.course_id, v_lesson_id, v_uid) then
    raise exception 'This lesson is not released yet.' using errcode = 'P0001';
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

  -- (b) 100 so com todas as aulas; o arredondamento para no 99.
  if v_total_lessons > 0 and v_completed_count >= v_total_lessons then
    v_progress := 100;
  elsif v_total_lessons > 0 then
    v_progress := least(
      99,
      greatest(0, round((v_completed_count::numeric / v_total_lessons) * 100))
    );
  else
    v_progress := 0;
  end if;
  v_status := case when v_progress >= 100 then 'completed' else 'active' end;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.enrollments set
    progress_percent = v_progress,
    -- (c) O pico nunca desce: e o que o teto do reembolso le.
    max_progress_percent = greatest(max_progress_percent, v_progress),
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

-- ---------------------------------------------------------------------------
-- 3. issue_skillset_certificate: conclusao medida agora, contra o curso atual.
-- ---------------------------------------------------------------------------
--
-- progress_percent/status so mudam quando o aluno marca uma aula. Se o
-- professor acrescenta aulas, o 'completed' gravado emitia certificado de um
-- curso que o aluno nao terminou; se remove, quem terminou tudo o que existe
-- ficava preso abaixo de 100. Aqui a conta e refeita na hora: aulas do
-- curriculo atual com linha em lesson_progress contra o total de aulas atual
-- (mesma leitura de courses.modules que record_lesson_progress faz).
-- Certificado ja emitido nao e tocado; a reemissao ('refund_revoked' ->
-- 'issued') passa pela mesma conta.

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
  where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only request your own certificate.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 4. send_course_message: o aviso ao aluno abre a aba de mensagens do curso.
-- ---------------------------------------------------------------------------
--
-- O link usava courses.slug, que nada preenche, e caia sempre em /learn. A sala
-- do aluno e /learn/courses/<id do curso> (LearnCoursePage resolve o id; mesmo
-- formato de grant_course_access e notify_enrolled_on_course_event), e
-- /messages e a aba da conversa (src/domain/classroom-tabs.ts).

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
  perform public.require_strong_session();

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
          then '/learn/courses/' || v_course_id || '/messages'
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

-- ---------------------------------------------------------------------------
-- 5. submit_course_review: trava o curso antes de ler a soma das notas.
-- ---------------------------------------------------------------------------
--
-- A media e calculada a partir de rating_sum/rating_count lidos sem trava: duas
-- avaliacoes simultaneas liam a mesma soma e a segunda escrita apagava a
-- primeira. `for update` na leitura do curso serializa as duas, o mesmo remedio
-- de 20260913012647 para a matricula e a cota.

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
  perform public.require_strong_session();

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
  where id = v_course_id
  for update;
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

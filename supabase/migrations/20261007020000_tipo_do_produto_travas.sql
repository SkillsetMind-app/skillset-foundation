-- Tipo do produto: as travas que faltavam depois de 20261007010000.
--
-- 1. product_format passa a ser coluna congelada: so a criacao (RPC de nove
--    argumentos, escrita confiavel), admin, ops e service_role mudam o tipo.
--    O dono trocava por PATCH direto, ate depois de publicar.
-- 2. issue_skillset_certificate recusa e-book: baixar um arquivo nao e
--    concluir um curso.
-- 3. submit_course_review deixa de cobrar 50% de progresso quando o produto
--    nao tem trilha de aulas: tipo diferente de course, ou curso sem aula. Ali
--    o progresso fica em 0 para sempre e ninguem avaliava.
-- 4. get_live_event_session: a pagina de venda de um evento ao vivo mostra a
--    data da sessao e o fuso de quem ensina. course_events so abre para dono e
--    matriculado; a funcao entrega so a data e o fuso, nunca o link.
-- 5. Sessao nova de um evento ao vivo so no futuro: a criacao do produto
--    deixava marcar uma data que ja passou.
--
-- Cada funcao parte da definicao vigente, com a MESMA assinatura, SECURITY
-- DEFINER e search_path:
--   courses_freeze_privileged_columns: 20260910062000_ops_nao_troca_dono_nem_preco.sql
--   issue_skillset_certificate, submit_course_review:
--     20261005010000_progresso_reembolso_drip_certificado.sql
-- CREATE OR REPLACE preserva dono e grants. Idempotente: funcoes em create
-- or replace, gatilho recriado (drop if exists + create).
--
-- Prova: supabase/tests/20261007020000_tipo_do_produto_travas_smoke.sql.

-- ---------------------------------------------------------------------------
-- 1. product_format congelado.
-- ---------------------------------------------------------------------------
-- Corpo de 20260910062000 mais um bloco no fim, com mensagem propria: a
-- mensagem antiga do congelamento continua igual (o smoke de 20260910061000
-- confere o texto).
CREATE OR REPLACE FUNCTION public.courses_freeze_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := (SELECT auth.uid())::text;
  v_trusted boolean := public.is_service_role() OR public.is_admin()
    OR current_setting('skillset.trusted_write', true) = 'on';
  v_owner_changed boolean := NEW.owner_id IS DISTINCT FROM OLD.owner_id;
  v_fee_changed boolean := NEW.platform_fee_bps IS DISTINCT FROM OLD.platform_fee_bps;
  v_price_changed boolean := NEW.price_amount_minor IS DISTINCT FROM OLD.price_amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
    OR NEW.installments_enabled IS DISTINCT FROM OLD.installments_enabled
    OR NEW.installments_max IS DISTINCT FROM OLD.installments_max;
BEGIN
  IF (v_owner_changed OR v_fee_changed) AND NOT v_trusted THEN
    RAISE EXCEPTION 'courses: owner_id and platform_fee_bps are privileged (admin/service only)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_price_changed AND NOT (v_trusted OR OLD.owner_id = v_actor) THEN
    RAISE EXCEPTION 'courses: price fields may only change by the course owner, an admin or the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert direto, não log_audit_event: aquela engole erro, e aqui a falha
  -- da auditoria tem de derrubar a troca.
  IF (v_owner_changed OR v_fee_changed OR v_price_changed) AND v_actor IS DISTINCT FROM OLD.owner_id THEN
    INSERT INTO public.audit_log(id, action, actor_id, actor_email, target_type, target_id, summary, metadata, created_at)
    VALUES (
      gen_random_uuid()::text,
      CASE WHEN v_owner_changed THEN 'course.owner_changed' ELSE 'course.price_changed' END,
      coalesce(v_actor, CASE WHEN public.is_service_role() THEN 'system:service_role' ELSE 'system:database' END),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'course',
      OLD.id,
      CASE WHEN v_owner_changed THEN 'Course owner changed by someone other than the owner.'
        ELSE 'Course price or fee changed by someone other than the owner.' END,
      jsonb_build_object(
        'previous', jsonb_build_object('owner_id', OLD.owner_id, 'price_amount_minor', OLD.price_amount_minor,
          'currency', OLD.currency, 'payment_type', OLD.payment_type,
          'installments_enabled', OLD.installments_enabled, 'installments_max', OLD.installments_max,
          'platform_fee_bps', OLD.platform_fee_bps),
        'next', jsonb_build_object('owner_id', NEW.owner_id, 'price_amount_minor', NEW.price_amount_minor,
          'currency', NEW.currency, 'payment_type', NEW.payment_type,
          'installments_enabled', NEW.installments_enabled, 'installments_max', NEW.installments_max,
          'platform_fee_bps', NEW.platform_fee_bps)),
      clock_timestamp());
  END IF;

  IF public.is_service_role() OR public.is_admin() OR public.is_ops()
     OR current_setting('skillset.trusted_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status           IS DISTINCT FROM OLD.status
     OR NEW.featured      IS DISTINCT FROM OLD.featured
     OR NEW.featured_rank IS DISTINCT FROM OLD.featured_rank
     OR NEW.rating_average    IS DISTINCT FROM OLD.rating_average
     OR NEW.rating_count      IS DISTINCT FROM OLD.rating_count
     OR NEW.trending_score    IS DISTINCT FROM OLD.trending_score
     OR NEW.enrollment_count  IS DISTINCT FROM OLD.enrollment_count
     OR NEW.platform_fee_bps  IS DISTINCT FROM OLD.platform_fee_bps THEN
    RAISE EXCEPTION 'courses: status/featured/featured_rank/rating/trending/enrollment/platform_fee_bps are privileged (admin/ops/service only)';
  END IF;
  -- O tipo e escolhido na criacao e decide o que publicar cobra; o construtor
  -- nao oferece troca.
  IF NEW.product_format IS DISTINCT FROM OLD.product_format THEN
    RAISE EXCEPTION 'courses: product_format is set at creation (admin/ops/service only)';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. issue_skillset_certificate: e-book nao emite certificado.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. submit_course_review: sem trilha de aulas, sem regra dos 50%.
-- ---------------------------------------------------------------------------
-- Mesma regra no cliente (course-review-panel.tsx).
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
  -- Os 50% so valem para curso com aula: comunidade, evento ao vivo e e-book
  -- (e curso sem aula) nao tem trilha, e o progresso nunca sairia do 0.
  if coalesce(v_course.product_format, 'course') = 'course'
     and exists (
       select 1
       from jsonb_array_elements(
              case when jsonb_typeof(v_course.modules) = 'array' then v_course.modules else '[]'::jsonb end
            ) m,
            jsonb_array_elements(
              case when jsonb_typeof(m->'lessons') = 'array' then m->'lessons' else '[]'::jsonb end
            ) l
     )
     and coalesce(v_enrollment.progress_percent, 0) < 50 then
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

-- ---------------------------------------------------------------------------
-- 4. get_live_event_session: a data da sessao para a pagina de venda.
-- ---------------------------------------------------------------------------
-- So produto publicado do tipo live_event. A proxima sessao agendada; sem
-- nenhuma por vir, a ultima (a pagina mostra a data real, mesmo passada).
-- O fuso e o do perfil de quem ensina (users.timezone, IANA), ou null.
-- starts_at e texto ISO (toISOString); so entra o que tem cara de data, como
-- em publish_teacher_course.
create or replace function public.get_live_event_session(p_course_id text)
returns table (starts_at text, timezone text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select s.starts_at, s.timezone
  from (
    select e.starts_at,
           e.starts_at::timestamptz as starts_at_ts,
           nullif(btrim(coalesce(u.timezone, '')), '') as timezone
    from public.courses c
    join public.course_events e
      on e.course_id = c.id
     and e.status = 'scheduled'
     and e.starts_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    left join public.users u on u.uid = c.owner_id
    where c.id = p_course_id
      and c.status = 'published'
      and c.product_format = 'live_event'
  ) s
  order by (s.starts_at_ts > now()) desc,
           case when s.starts_at_ts > now() then s.starts_at_ts end asc,
           s.starts_at_ts desc
  limit 1;
$function$;

revoke all on function public.get_live_event_session(text) from public;
grant execute on function public.get_live_event_session(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Evento ao vivo: sessao nova so no futuro.
-- ---------------------------------------------------------------------------
-- A tela de criacao grava o produto pela RPC de nove argumentos e, logo
-- depois, a sessao por um insert do proprio dono em course_events: a RPC nunca
-- ve a data, entao a trava mora aqui. Uma sessao no passado deixava o produto
-- sem data para vender, e publicar recusava sem dizer por que.
-- So produto live_event: a Agenda continua registrando sessao passada nos
-- outros tipos. Admin, service_role e escrita confiavel passam.
create or replace function public.course_events_live_session_in_future()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.is_service_role() or public.is_admin()
     or current_setting('skillset.trusted_write', true) = 'on' then
    return new;
  end if;
  if exists (
       select 1 from public.courses c
       where c.id = new.course_id and c.product_format = 'live_event'
     )
     -- starts_at e texto ISO; o case so converte o que tem cara de data.
     and not case
           when coalesce(new.starts_at, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
             then new.starts_at::timestamptz > now()
           else false
         end then
    raise exception 'The live session must start in the future.';
  end if;
  return new;
end;
$function$;

revoke all on function public.course_events_live_session_in_future() from public, anon, authenticated;

drop trigger if exists course_events_live_session_in_future_trg on public.course_events;
create trigger course_events_live_session_in_future_trg
  before insert on public.course_events
  for each row execute function public.course_events_live_session_in_future();

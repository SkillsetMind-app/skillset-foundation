-- As travas de pagamentos, cursos, matrículas, notificações e tickets existem
-- em produção, mas nunca estiveram numa migration.
--
-- 14 triggers só aparecem no snapshot supabase/schema/remote_schema_2026-07-21.sql,
-- junto com 8 das funções deles. As definições abaixo foram lidas do catálogo
-- de produção em 10/09 (pg_get_functiondef e pg_get_triggerdef, só leitura) e
-- são idênticas às do snapshot. As outras cinco funções já vivem em migrations
-- e ficam onde estão: handle_new_user (20260819230000),
-- enrollments_owner_update_guard (20260906010000) e os três guardas de
-- comunidade (20260906020000). Aqui entram só os triggers delas.
--
-- Hoje o banco efêmero do CI recebe as travas porque scripts/build-test-db.sh
-- aplica o snapshot inteiro antes das migrations. Um banco montado só por
-- supabase/migrations/ nasceria sem elas: o aluno troca status ou course_id da
-- própria matrícula, o dono publica o curso escrevendo `status` e o cliente
-- grava em payments e payout_ledger.
--
-- Em produção isto é no-op: CREATE OR REPLACE com o mesmo corpo, e cada
-- trigger só é criado se faltar. Derrubar e recriar pegaria ACCESS EXCLUSIVE
-- em payments, courses, enrollments e auth.users para não mudar nada (mesmo
-- padrão de 20260904010000). A asserção no fim é o teste: se um ambiente
-- montar essas tabelas sem as travas, ou com uma delas desligada, a migration
-- falha alto.

CREATE OR REPLACE FUNCTION public.course_event_rsvps_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.event_id    IS DISTINCT FROM OLD.event_id
     OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.user_id   IS DISTINCT FROM OLD.user_id
     OR NEW.uid       IS DISTINCT FROM OLD.uid
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'course_event_rsvps: only attendee_name, attendee_email, status, updated_at may change';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.course_events_teacher_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id     IS DISTINCT FROM OLD.owner_id
     OR NEW.course_id   IS DISTINCT FROM OLD.course_id
     OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.course_title IS DISTINCT FROM OLD.course_title
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'course_events: teacher may only modify title, description, type, status, starts_at, external_url, recording_asset_id';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.courses_freeze_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
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
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lesson_comments_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.course_id   IS DISTINCT FROM OLD.course_id
     OR NEW.lesson_id   IS DISTINCT FROM OLD.lesson_id
     OR NEW.author_id   IS DISTINCT FROM OLD.author_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'lesson_comments: only body may be edited';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notifications_client_read_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.notification_id IS DISTINCT FROM OLD.notification_id
     OR NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.type       IS DISTINCT FROM OLD.type
     OR NEW.title      IS DISTINCT FROM OLD.title
     OR NEW.body       IS DISTINCT FROM OLD.body
     OR NEW.link       IS DISTINCT FROM OLD.link
     OR NEW.actor_name IS DISTINCT FROM OLD.actor_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notifications: clients may only modify the read flag';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_enrolled_on_course_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_when text;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;

  -- starts_at is stored as ISO text; format defensively.
  begin
    v_when := to_char(new.starts_at::timestamptz, 'FMMon DD, YYYY at HH24:MI "UTC"');
  exception when others then
    v_when := new.starts_at;
  end;

  insert into public.notifications
    (notification_id, user_id, type, title, body, read, link, actor_name, created_at)
  select
    gen_random_uuid()::text,
    e.user_id,
    'live_event',
    'Live session scheduled: ' || new.title,
    new.course_title || ' — ' || v_when,
    false,
    '/learn/courses/' || new.course_id,
    null,
    now()
  from public.enrollments e
  where e.course_id = new.course_id
    and e.status in ('active', 'completed')
    and e.user_id <> new.owner_id;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.server_write_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'table %.% is server-write only', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_tickets_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.user_email IS DISTINCT FROM OLD.user_email
     OR NEW.user_name  IS DISTINCT FROM OLD.user_name
     OR NEW.category   IS DISTINCT FROM OLD.category
     OR NEW.subject    IS DISTINCT FROM OLD.subject
     OR NEW.message    IS DISTINCT FROM OLD.message
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'support_tickets: only status/admin_response/responded_by/responded_at may change';
  END IF;
  RETURN NEW;
END;
$function$;

-- Mesmo ACL de produção: só o dono e o service_role executam. Num banco novo
-- a função nasceria com EXECUTE para PUBLIC.
REVOKE ALL ON FUNCTION
  public.course_event_rsvps_update_guard(),
  public.course_events_teacher_update_guard(),
  public.courses_freeze_privileged_columns(),
  public.lesson_comments_update_guard(),
  public.notifications_client_read_only_guard(),
  public.notify_enrolled_on_course_event(),
  public.server_write_only(),
  public.support_tickets_update_guard()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.course_event_rsvps_update_guard(),
  public.course_events_teacher_update_guard(),
  public.courses_freeze_privileged_columns(),
  public.lesson_comments_update_guard(),
  public.notifications_client_read_only_guard(),
  public.notify_enrolled_on_course_event(),
  public.server_write_only(),
  public.support_tickets_update_guard()
TO service_role;

-- tgtype: 19 = BEFORE UPDATE por linha; 31 = BEFORE INSERT/UPDATE/DELETE por
-- linha; 5 = AFTER INSERT por linha. Conferido contra produção.
do $$
declare
  t record;
begin
  for t in select * from (values
    ('community_comments_update_guard',        'public.community_comments', 'before update', 'public.community_comments_update_guard()', 19),
    ('community_posts_update_guard',           'public.community_posts',    'before update', 'public.community_posts_update_guard()', 19),
    ('community_reports_update_guard',         'public.community_reports',  'before update', 'public.community_reports_update_guard()', 19),
    ('course_event_rsvps_update_guard',        'public.course_event_rsvps', 'before update', 'public.course_event_rsvps_update_guard()', 19),
    ('course_event_notify_enrolled',           'public.course_events',      'after insert',  'public.notify_enrolled_on_course_event()', 5),
    ('course_events_teacher_update_guard_trg', 'public.course_events',      'before update', 'public.course_events_teacher_update_guard()', 19),
    ('courses_freeze_privileged_columns_trg',  'public.courses',            'before update', 'public.courses_freeze_privileged_columns()', 19),
    ('enrollments_owner_update_guard',         'public.enrollments',        'before update', 'public.enrollments_owner_update_guard()', 19),
    ('lesson_comments_update_guard',           'public.lesson_comments',    'before update', 'public.lesson_comments_update_guard()', 19),
    ('trg_notifications_client_read_only',     'public.notifications',      'before update', 'public.notifications_client_read_only_guard()', 19),
    ('payments_server_write_only',             'public.payments',           'before insert or update or delete', 'public.server_write_only()', 31),
    ('payout_ledger_server_write_only',        'public.payout_ledger',      'before insert or update or delete', 'public.server_write_only()', 31),
    ('support_tickets_update_guard',           'public.support_tickets',    'before update', 'public.support_tickets_update_guard()', 19),
    ('on_auth_user_created',                   'auth.users',                'after insert',  'public.handle_new_user()', 5)
  ) as v(nome, tabela, quando, funcao, tipo)
  loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = t.tabela::regclass and tgname = t.nome and not tgisinternal
    ) then
      execute format('create trigger %I %s on %s for each row execute function %s',
        t.nome, t.quando, t.tabela, t.funcao);
    end if;

    if not exists (
      select 1 from pg_trigger
      where tgrelid = t.tabela::regclass and tgname = t.nome and not tgisinternal
        and tgenabled <> 'D'
        and tgfoid = t.funcao::regprocedure
        and tgtype = t.tipo
    ) then
      raise exception
        'Trava % em % ausente, desabilitada ou ligada a outra função: sem ela o banco aceita escrita que produção recusa.',
        t.nome, t.tabela;
    end if;
  end loop;
end $$;

-- Ops trocava o dono e o preço de qualquer curso e desviava as vendas.
--
-- A matriz de permissões diz que ops fica sem poder sobre dinheiro
-- (src/lib/permissions/index.ts), mas a policy courses_update_ops deixa ops
-- atualizar qualquer coluna de qualquer curso, e o congelamento de colunas
-- isentava ops e nem olhava owner_id. Com o próprio JWT, uma conta ops trocava
-- owner_id por um cúmplice com Connect pronto (o checkout lê o Connect do dono
-- atual e cria a sessão de pagamento na conta dele) ou zerava o preço.
-- P1-2 da auditoria de permissões de 10/09.
--
-- Agora, no mesmo trigger, antes do congelamento que já existia:
--   owner_id e platform_fee_bps: só service_role, admin ou escrita confiável
--     do banco (skillset.trusted_write, que só RPCs e manutenção ligam);
--   preço (price_amount_minor, currency, payment_type, installments_*): os
--     mesmos, mais o próprio dono, que edita o preço no construtor de cursos;
--   toda troca de dono, preço ou taxa feita por quem não é o dono entra no
--     audit_log na mesma transação. Se a gravação falhar, a troca não acontece.
-- O resto do congelamento (status, destaque, contadores) fica como estava:
-- ops continua moderando status. Mensagem antiga mantida.
--
-- Fora daqui: trocar courses_update_ops por uma RPC de moderação muda a tela de
-- Operations e fica para depois. Depende de 20260910061000, que versiona o
-- corpo anterior desta função: aplicar aquela antes desta.

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
  RETURN NEW;
END;
$function$;

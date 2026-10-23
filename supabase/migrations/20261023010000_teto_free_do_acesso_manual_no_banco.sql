-- O teto do plano Free no acesso manual (10 por dia, #473) só existia na rota.
--
-- /api/teach/course-access conta course_access_daily_<uid> antes de chamar
-- grant_course_access, mas a RPC é EXECUTE para authenticated: um criador Free
-- com curso publicado chamava POST /rest/v1/rpc/grant_course_access direto e
-- ficava só com os 30/hora da RPC (~720 por dia). É o mesmo buraco do P2-5
-- (ativação só na rota), fechado em 20260910066500; voltou quando o teto Free
-- entrou só na rota. Achado da auditoria de segurança de 23/10.
--
-- O conserto segue o par que já existe para o limite por hora: a rota conta
-- course_access_<uid> e a RPC conta course_grant_rpc_<uid>. Aqui a RPC ganha
-- course_grant_rpc_daily_<uid>, com chave própria para não contar duas vezes
-- quem passa pela rota. O predicado é o mesmo do isOnFreePlan da rota:
-- current_plan_id fora dos planos pagos de src/data/plans.ts.
--
-- Corpo de produção de 23/10 (pg_get_functiondef, igual ao de 20260910066500)
-- mais o bloco do teto. Mesma assinatura: create or replace mantém dono,
-- grants e comentário.

create or replace function public.grant_course_access(p_course_id text, p_email text)
 returns public.course_access_grants
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE g public.course_access_grants; v_email text:=lower(btrim(p_email)); v_uid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.session_is_strong() OR NOT EXISTS (
    SELECT FROM public.courses WHERE id=p_course_id AND owner_id=auth.uid()::text AND status='published'
  ) THEN RAISE EXCEPTION 'Course owner and published course required' USING ERRCODE='42501'; END IF;
  -- P2-5 (10/09): a ativação (#303) vale aqui também, não só na rota.
  IF public.creator_activation_blocked() THEN
    RAISE EXCEPTION 'Pay the one-time activation fee before granting course access.';
  END IF;
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023';
  END IF;
  PERFORM public.enforce_rate_limit('course_grant_rpc_' || auth.uid()::text,30,3600000);
  -- 23/10: o teto Free (10 por dia) vale aqui também, não só na rota.
  IF coalesce((SELECT current_plan_id FROM public.users WHERE uid=auth.uid()::text),'free')
       NOT IN ('basic','starter','pro','plus') THEN
    PERFORM public.enforce_rate_limit('course_grant_rpc_daily_' || auth.uid()::text,10,86400000);
  END IF;
  INSERT INTO public.course_access_grants(course_id,learner_email,granted_by)
    VALUES(p_course_id,v_email,auth.uid()::text) ON CONFLICT(course_id,learner_email) DO NOTHING;
  SELECT * INTO STRICT g FROM public.course_access_grants WHERE course_id=p_course_id AND learner_email=v_email FOR UPDATE;
  IF g.granted_by<>auth.uid()::text THEN RAISE EXCEPTION 'Grant belongs to another creator' USING ERRCODE='42501'; END IF;
  UPDATE public.course_access_grants SET revoked_at=null,access_status=CASE WHEN revoked_at IS NOT NULL THEN 'pending' ELSE access_status END,updated_at=now() WHERE id=g.id RETURNING * INTO g;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email)=v_email AND email_confirmed_at IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_uid IS NOT NULL THEN g:=public.apply_course_access_grant(g.id,v_uid); END IF;
  PERFORM public.log_audit_event('course_access.grant',auth.uid()::text,null,'course_access_grant',g.id::text,'Course access recorded',jsonb_build_object('courseId',p_course_id));
  RETURN g;
END $function$;

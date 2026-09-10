-- Sem ativação, o criador ainda dava acesso manual a curso, criava e ligava
-- cupom e conectava domínio próprio: bastava chamar a RPC direto pelo PostgREST.
--
-- P2-5 da auditoria de permissões de 10/09. A ativação (#303) só era cobrada na
-- rota. /api/teach/course-access recusa com assertCreatorActivated antes de
-- chamar grant_course_access, mas a RPC é EXECUTE para authenticated e dispensa
-- a rota. Cupom não tem rota (a tela chama as RPCs direto) e a rota de domínio
-- não conferia a ativação.
--
-- Cada corpo abaixo é o de produção de 10/09, lido com pg_get_functiondef, mais
-- uma recusa. O predicado é o mesmo da publicação e do checkout:
-- creator_activation_blocked(). Sem argumento, quem está logado consulta a si
-- mesmo, e o próprio predicado já isenta admin (is_admin() de quem chama). A
-- course_owner_can_sell precisou do ramo explícito de admin porque lá quem
-- pergunta é a service role; aqui quem chama é o próprio criador.
--
-- A frase segue a dos outros portões do banco ("Pay the one-time activation fee
-- before ..."): a tela reconhece "activation fee" e mostra o texto certo.
--
-- Continua livre o que só reduz exposição: pausar e apagar cupom, revogar
-- acesso e soltar domínio. O upload em course-content e public-media fica para
-- outro PR, porque mudar policy de upload pede teste com upload real.
--
-- Mesma assinatura: create or replace mantém dono, grants e comentário.

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

create or replace function public.create_course_coupon(p_course_id text, p_code text,
  p_percent_off integer, p_max_redemptions integer,
  p_expires_at timestamp with time zone default null::timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_code text := upper(btrim(coalesce(p_code,'')));
  v_count integer;
BEGIN
  PERFORM public.require_strong_session();
  -- P2-5 (10/09): a ativação (#303) vale aqui também, não só na rota.
  if public.creator_activation_blocked() then
    raise exception 'Pay the one-time activation fee before creating coupons.';
  end if;
  -- Serialize coupon writes per course (cap + duplicate checks below).
  perform 1 from public.courses where id = p_course_id for update;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then
    raise exception 'Coupon codes use 3-24 letters, numbers, or dashes.';
  end if;
  if p_percent_off is null or p_percent_off < 5 or p_percent_off > 90 then
    raise exception 'Discount must be between 5%% and 90%%.';
  end if;
  if p_max_redemptions is not null
     and (p_max_redemptions < 1 or p_max_redemptions > 100000) then
    raise exception 'Redemption limit must be between 1 and 100000, or blank for unlimited.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future.';
  end if;
  select count(*) into v_count from public.course_coupons where course_id = p_course_id;
  if v_count >= 50 then
    raise exception 'This course already has 50 coupons — remove one first.';
  end if;
  if exists (
    select 1 from public.course_coupons
    where course_id = p_course_id and code = v_code
  ) then
    raise exception 'That coupon code already exists for this course.';
  end if;

  insert into public.course_coupons
    (course_id, owner_id, code, percent_off, max_redemptions, expires_at)
  values
    (p_course_id, v_uid, v_code, p_percent_off, p_max_redemptions, p_expires_at);

  return jsonb_build_object('success', true, 'code', v_code);
end;
$function$;

create or replace function public.set_course_coupon_active(p_coupon_id uuid, p_active boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coupon public.course_coupons%rowtype;
  v_uid text;
BEGIN
  PERFORM public.require_strong_session();
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  v_uid := public.assert_course_owner(v_coupon.course_id);
  if coalesce(p_active, false) then
    if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
      raise exception 'This coupon has expired — create a new one instead.';
    end if;
    if coalesce((
         select (ps.value #>> '{}')::boolean
         from public.platform_settings ps
         where ps.key = 'require_creator_verification'
       ), false)
       and coalesce((
         select u.creator_verification_status
         from public.users u where u.uid = v_uid
       ), 'none') <> 'approved' then
      raise exception 'Professional verification must be approved before a coupon can be activated.';
    end if;
    -- P2-5 (10/09): a ativação (#303) vale aqui também, não só na rota.
    if public.creator_activation_blocked() then
      raise exception 'Pay the one-time activation fee before a coupon can be activated.';
    end if;
  end if;

  update public.course_coupons
    set active = coalesce(p_active, false), updated_at = now()
  where id = p_coupon_id;

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.claim_custom_domain(p_hostname text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_plan text;
  v_used integer;
  v_limit integer;
  v_id text;
BEGIN
  PERFORM public.require_strong_session();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- P2-5 (10/09): a ativação (#303) vale aqui também, não só na rota.
  if public.creator_activation_blocked() then
    raise exception 'Pay the one-time activation fee before connecting a custom domain.';
  end if;

  -- O lock na linha do dono é o que torna a cota atômica: fica preso até o
  -- commit. Duas reivindicações simultâneas do mesmo professor deixam de ver o
  -- mesmo count — a segunda espera a primeira terminar e conta o que ela
  -- inseriu. Sem ele, N POSTs paralelos davam N domínios pelo preço de 1.
  select current_plan_id into v_plan
    from public.users
   where uid = v_uid
     for update;
  v_limit := public.custom_domain_limit_for_plan(v_plan);

  if v_limit = 0 then
    raise exception 'custom domains are not included on this plan'
      using errcode = 'P0001';
  end if;

  select count(*) into v_used from public.custom_domains where owner_uid = v_uid;

  if v_used >= v_limit then
    raise exception 'domain quota reached: % of %', v_used, v_limit
      using errcode = 'P0001';
  end if;

  -- Sempre nasce pending_dns. Nunca active: a Vercel e quem decide se um
  -- dominio esta verificado, e ate ela dizer que sim este dominio nao pode
  -- aparecer em public_domains.
  insert into public.custom_domains (owner_uid, hostname, status)
  values (v_uid, lower(trim(p_hostname)), 'pending_dns')
  returning id into v_id;

  return v_id;
end;
$function$;

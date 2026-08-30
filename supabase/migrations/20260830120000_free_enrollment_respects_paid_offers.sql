-- Curso pago entregue de graça (auditoria 2026-08-30, achado A-02 · CRÍTICO).
--
-- create_free_course_enrollment decidia se o curso é grátis olhando SÓ as
-- colunas legadas de `courses`:
--
--     if not (v_course.payment_type = 'free'
--             or coalesce(v_course.price_amount_minor, 0) = 0) then
--
-- Essas colunas só são escritas por set_default_product_offer (ver
-- 20260716_checkout_offer_integrity.sql). Uma oferta paga criada com
-- is_default = false — que é exatamente o caminho de upsell/order bump que
-- product_offers existe para suportar — nunca as atualiza. O resultado é um
-- curso que a página de vendas mostra por US$ 497, que o checkout cobra pelo
-- Stripe Connect, e que qualquer usuário logado leva de graça com uma chamada:
--
--     await supabase.rpc('create_free_course_enrollment', { p_course_id: '<id>' })
--
-- E a matrícula fica marcada como source = 'free_course', então nem a
-- conciliação denuncia a diferença: o professor perde a venda, a plataforma
-- perde a taxa, e não sobra rastro de que houve uma.
--
-- A correção mantém o portão antigo (defesa em profundidade) e acrescenta o que
-- faltava: se o curso tem QUALQUER preço pago ativo em product_prices, a
-- matrícula grátis é recusada, venha esse preço da oferta padrão ou não.
--
-- Curso genuinamente grátis continua passando: sem linha paga em
-- product_prices, a nova checagem não encontra nada e o fluxo segue igual.

create or replace function public.create_free_course_enrollment(p_course_id text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course public.courses%rowtype;
  v_enrollment_id text;
  v_existing_status text;
  v_paid_offer_exists boolean;
begin
  if v_uid is null then
    raise exception 'unauthenticated: sign in before enrolling';
  end if;

  if p_course_id is null or length(btrim(p_course_id)) = 0 or length(p_course_id) > 160 then
    raise exception 'invalid-argument: a valid courseId is required';
  end if;

  perform public.enforce_rate_limit('free_enroll_' || v_uid, 20, 3600000);

  v_enrollment_id := v_uid || '__' || p_course_id;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'not-found: course not found';
  end if;

  if v_course.status <> 'published' then
    raise exception 'failed-precondition: this course is not available for enrollment right now';
  end if;

  -- Portão legado, mantido: cobre o curso cujas colunas ainda descrevem o preço.
  if not (v_course.payment_type = 'free' or coalesce(v_course.price_amount_minor, 0) = 0) then
    raise exception 'failed-precondition: this course requires checkout before enrollment';
  end if;

  -- Portão novo: a verdade sobre preço mora em product_offers/product_prices
  -- desde 20260716000400. Uma oferta ativa e paga torna o curso pago, mesmo que
  -- as colunas legadas de `courses` ainda digam 'free' por nunca terem sido
  -- sincronizadas (o que acontece sempre que is_default = false).
  select exists (
    select 1
    from public.product_offers o
    join public.product_prices p on p.offer_id = o.id
    where o.course_id = p_course_id
      and coalesce(o.active, true)
      and coalesce(p.active, true)
      and p.payment_type <> 'free'
      and coalesce(p.amount_minor, 0) > 0
  ) into v_paid_offer_exists;

  if v_paid_offer_exists then
    raise exception 'failed-precondition: this course requires checkout before enrollment';
  end if;

  select status into v_existing_status
  from public.enrollments
  where id = v_enrollment_id;
  if v_existing_status in ('active', 'completed') then
    return v_enrollment_id;
  end if;

  insert into public.enrollments (
    id, user_id, course_id, course_slug, course_title, course_category, course_image,
    status, source, progress_percent, last_lesson_id, created_at, updated_at
  ) values (
    v_enrollment_id, v_uid, p_course_id, p_course_id, v_course.title, v_course.category,
    coalesce(v_course.cover_image_url, '/brand/logo-mark.png'),
    'active', 'free_course', 0, null, now(), now()
  )
  on conflict (id) do update set
    status = 'active',
    updated_at = now()
  where public.enrollments.status not in ('active', 'completed');

  return v_enrollment_id;
end;
$function$;

-- A asserção É o teste: falha alto se a função voltar a ignorar product_offers.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_free_course_enrollment';

  assert v_def like '%product_offers%',
    'create_free_course_enrollment voltou a decidir preco sem olhar product_offers';
  assert v_def like '%product_prices%',
    'create_free_course_enrollment voltou a decidir preco sem olhar product_prices';
end $$;

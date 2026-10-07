-- Como as pessoas vao pagar: cada tipo de produto aceita so as formas de
-- pagar que fazem sentido para ele. A etapa de preco do construtor mostra
-- estes cartoes, e o banco recusa o resto:
--
--   course:     free, one_time, subscription_monthly, subscription_yearly
--   community:  free, subscription_monthly, subscription_yearly
--   live_event: free, one_time (o ingresso)
--   ebook:      free, one_time
--
-- Antes, nada impedia uma comunidade de virar "pagamento unico" nem um
-- evento ao vivo de cobrar todo mes: a pergunta aparecia em tres lugares e
-- cada um aceitava as quatro respostas.
--
-- 1. course_payment_type_fits_format(tipo, forma de pagar): a lista acima.
--    payment_type nulo (curso antigo) le como o construtor sempre leu:
--    preco 0 e gratis, o resto e pagamento unico.
-- 2. Gatilho em courses. A trava fica na tabela, e nao em cada RPC: criar
--    (create_teacher_course_draft), salvar o construtor
--    (update_teacher_course_builder), publicar (publish_teacher_course) e a
--    oferta principal que copia o preco (set_default_product_offer) escrevem
--    courses, e um gatilho cobre todas sem copiar nenhuma. A RPC devolve o
--    erro do gatilho e nada e gravado.
--    - Criar ou trocar a forma de pagar (ou o tipo) para uma fora da lista:
--      recusado.
--    - Publicar com uma forma fora da lista: recusado.
--    - Produto que ja esta assim e so salva outra coisa (titulo, aulas):
--      passa. Nenhum preco existente muda nem trava a edicao.
-- 3. Gatilho em product_prices: um preco extra (Ofertas) segue a lista do
--    tipo do produto. Preco que ja existe e nao muda de forma passa.
-- 4. Produto publicado e cobrado nao perde o valor: trocar a forma de pagar
--    ou o preco para "cobrado sem valor" e recusado (PAID_PRODUCT_NEEDS_PRICE).
--    Preco nulo num produto pago abria a entrada gratis
--    (create_free_course_enrollment le nulo como zero).
-- 5. create_product_offer_atomic: um preco a mais so entra ao lado de um
--    preco principal ativo (PRODUCT_OFFER_NEEDS_MAIN_PRICE). Sem principal, o
--    checkout cobra o primeiro preco ativo, e o plano anual virava o preco da
--    pagina. Mesma assinatura e mesmas permissoes de antes.
--
-- Nenhum dado muda. Idempotente: create or replace e drop trigger if exists.
-- As funcoes dos gatilhos tem search_path fixo; a de product_prices e
-- SECURITY DEFINER porque le courses por tras de product_offers.

create or replace function public.course_payment_type_fits_format(
  p_format text,
  p_payment_type text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case coalesce(p_format, 'course')
    when 'community' then p_payment_type in ('free', 'subscription_monthly', 'subscription_yearly')
    when 'live_event' then p_payment_type in ('free', 'one_time')
    when 'ebook' then p_payment_type in ('free', 'one_time')
    else p_payment_type in ('free', 'one_time', 'subscription_monthly', 'subscription_yearly')
  end;
$$;

comment on function public.course_payment_type_fits_format(text, text) is
  'Formas de pagar que cada tipo de produto aceita. Espelho: paymentTypeFitsFormat em src/domain/teacher-course.ts.';

create or replace function public.courses_payment_type_fits_format()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new text := coalesce(
    new.payment_type,
    case when coalesce(new.price_amount_minor, 0) = 0 then 'free' else 'one_time' end
  );
  v_old text;
begin
  if tg_op = 'UPDATE'
     and new.status = 'published'
     and v_new <> 'free'
     and coalesce(new.price_amount_minor, 0) <= 0
     and (new.price_amount_minor is distinct from old.price_amount_minor
          or new.payment_type is distinct from old.payment_type) then
    raise exception 'PAID_PRODUCT_NEEDS_PRICE: a published product sold as % needs a price.', v_new
      using errcode = 'check_violation';
  end if;

  if public.course_payment_type_fits_format(new.product_format, v_new) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := coalesce(
      old.payment_type,
      case when coalesce(old.price_amount_minor, 0) = 0 then 'free' else 'one_time' end
    );
    -- Ja estava assim, a forma de pagar e o tipo nao mudaram e nao e a
    -- publicacao: salva como sempre salvou.
    if v_new = v_old
       and new.product_format is not distinct from old.product_format
       and not (new.status = 'published' and old.status is distinct from 'published') then
      return new;
    end if;
  end if;

  raise exception 'PAYMENT_TYPE_NOT_ALLOWED_FOR_FORMAT: a % product cannot be sold as %.',
    coalesce(new.product_format, 'course'), v_new
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists courses_payment_type_fits_format on public.courses;
create trigger courses_payment_type_fits_format
  before insert or update of payment_type, price_amount_minor, product_format, status
  on public.courses
  for each row execute function public.courses_payment_type_fits_format();

create or replace function public.product_prices_payment_type_fits_format()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_format text;
begin
  if tg_op = 'UPDATE'
     and new.payment_type is not distinct from old.payment_type
     and new.offer_id is not distinct from old.offer_id then
    return new;
  end if;

  select c.product_format into v_format
  from public.product_offers o
  join public.courses c on c.id = o.course_id
  where o.id = new.offer_id;

  if public.course_payment_type_fits_format(v_format, new.payment_type) then
    return new;
  end if;

  raise exception 'PAYMENT_TYPE_NOT_ALLOWED_FOR_FORMAT: a % product cannot be sold as %.',
    coalesce(v_format, 'course'), new.payment_type
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.product_prices_payment_type_fits_format() from public, anon, authenticated;

drop trigger if exists product_prices_payment_type_fits_format on public.product_prices;
create trigger product_prices_payment_type_fits_format
  before insert or update of payment_type, offer_id
  on public.product_prices
  for each row execute function public.product_prices_payment_type_fits_format();

-- 5. Um preco a mais so ao lado de um principal. Igual a
-- 20260716000400_financial_schema_hardening.sql, mais a trava depois do dono.
create or replace function public.create_product_offer_atomic(
  p_course_id text,
  p_owner_id text,
  p_offer_id text,
  p_price_id text,
  p_name text,
  p_amount_minor numeric,
  p_currency text,
  p_payment_type text,
  p_is_default boolean,
  p_public_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_course_owner text;
  v_name text := btrim(coalesce(p_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_payment_type text := btrim(coalesce(p_payment_type, ''));
  v_is_default boolean := coalesce(p_is_default, false);
  v_public_code text := nullif(upper(btrim(coalesce(p_public_code, ''))), '');
begin
  if btrim(coalesce(p_course_id, '')) = ''
     or btrim(coalesce(p_owner_id, '')) = ''
     or btrim(coalesce(p_offer_id, '')) = ''
     or btrim(coalesce(p_price_id, '')) = '' then
    raise exception 'INVALID_PRODUCT_OFFER_IDENTITY';
  end if;
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'INVALID_PRODUCT_OFFER_NAME';
  end if;
  if p_amount_minor is null
     or p_amount_minor < 0
     or trunc(p_amount_minor) <> p_amount_minor then
    raise exception 'INVALID_PRODUCT_OFFER_AMOUNT';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_PRODUCT_OFFER_CURRENCY';
  end if;
  if v_payment_type not in (
    'one_time',
    'subscription_monthly',
    'subscription_yearly',
    'free'
  ) then
    raise exception 'INVALID_PRODUCT_OFFER_PAYMENT_TYPE';
  end if;
  if (v_payment_type = 'free' and p_amount_minor <> 0)
     or (v_payment_type <> 'free' and p_amount_minor <= 0) then
    raise exception 'INVALID_PRODUCT_OFFER_PRICE';
  end if;
  if v_payment_type = 'free' and not v_is_default then
    raise exception 'FREE_PRODUCT_OFFER_MUST_BE_DEFAULT';
  end if;
  if v_public_code is not null
     and (
       char_length(v_public_code) > 24
       or v_public_code !~ '^[A-Z0-9-]+$'
     ) then
    raise exception 'INVALID_PRODUCT_OFFER_PUBLIC_CODE';
  end if;

  select owner_id into v_course_owner
  from public.courses
  where id = p_course_id
  for update;

  if not found then
    raise exception 'COURSE_NOT_FOUND';
  end if;
  if v_course_owner is distinct from p_owner_id then
    raise exception 'PRODUCT_OFFER_OWNER_MISMATCH';
  end if;
  if not v_is_default and not exists (
    select 1 from public.product_offers
    where course_id = p_course_id and is_default and active
  ) then
    raise exception 'PRODUCT_OFFER_NEEDS_MAIN_PRICE: add the main price before another price.';
  end if;

  insert into public.product_offers (
    id,
    course_id,
    name,
    is_default,
    active,
    public_code,
    created_at,
    updated_at
  ) values (
    p_offer_id,
    p_course_id,
    v_name,
    false,
    true,
    v_public_code,
    now(),
    now()
  );

  insert into public.product_prices (
    id,
    offer_id,
    amount_minor,
    currency,
    payment_type,
    stripe_price_id,
    active,
    created_at,
    updated_at
  ) values (
    p_price_id,
    p_offer_id,
    p_amount_minor,
    v_currency,
    v_payment_type,
    null,
    true,
    now(),
    now()
  );

  if v_is_default then
    perform public.set_default_product_offer(p_course_id, p_offer_id);
  end if;

  return jsonb_build_object(
    'offerId', p_offer_id,
    'priceId', p_price_id,
    'name', v_name,
    'amountMinor', p_amount_minor,
    'currency', v_currency,
    'paymentType', v_payment_type,
    'isDefault', v_is_default,
    'publicCode', v_public_code
  );
end;
$$;

revoke all on function public.create_product_offer_atomic(
  text, text, text, text, text, numeric, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.create_product_offer_atomic(
  text, text, text, text, text, numeric, text, text, boolean, text
) to service_role;

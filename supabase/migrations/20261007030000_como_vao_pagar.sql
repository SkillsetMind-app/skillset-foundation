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

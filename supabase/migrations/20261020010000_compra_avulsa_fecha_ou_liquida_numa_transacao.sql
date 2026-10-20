-- Compra avulsa: fechar (expired/failed) e liquidar (paid) viram, cada um, UMA
-- transacao com a linha do pedido travada.
--
-- Antes, o webhook do Stripe fazia tudo em chamadas separadas do PostgREST:
--   - fechar: lia o pedido, apagava o lock de checkout, soltava o cupom e
--     gravava failed/cancelled. Um paid que commitasse depois da leitura era
--     rebaixado, e o lock ja tinha saido antes de qualquer decisao.
--   - liquidar: resgatava o cupom, gravava payments e so depois marcava o
--     pedido paid, sem olhar o status atual. Um pedido ja fechado (cupom solto)
--     ou ja reembolsado voltava a paid.
--
-- Escopo fechado de proposito: so o pedido avulso (public.orders). Assinatura
-- de curso nao muda aqui. Recuperar sozinho um pedido fechado que depois foi
-- pago tambem NAO e feito aqui: settle_paid_course_order devolve 'closed', o
-- webhook alerta ops e tenta de novo, sem ressuscitar pedido nem cupom.
--
-- Ordem de locks (reserve_course_coupon trava cupom -> reserva):
--   close_unpaid_course_order          pedido -> reserva (nunca trava cupom)
--   settle_paid_course_order           pedido -> cupom -> reserva (via finalize)
--   finalize_course_coupon_reservation agora cupom -> reserva, e reconfere a
--                                      reserva depois do lock. Era o inverso.
-- Nenhum caminho trava reserva e depois cupom.
--
-- As duas funcoes novas sao SECURITY INVOKER: usam os privilegios de
-- service_role nas tabelas, os mesmos que o webhook ja usa. anon e
-- authenticated nao executam; e mesmo que executassem, nao escrevem em orders
-- nem em checkout_locks.

-- Aborta se a finalize viva nao for a que esta migration substitui (reserva
-- travada primeiro). Um hotfix desconhecido nao e sobrescrito em silencio.
DO $preflight$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'finalize_course_coupon_reservation';

  IF v_def IS NULL THEN
    RAISE EXCEPTION
      'finalize_course_coupon_reservation nao existe: a 20260716_checkout_offer_integrity precisa ter rodado antes.';
  END IF;

  IF v_def !~* 'from\s+public\.course_coupon_reservations\s+where\s+order_id\s*=\s*p_order_id\s+for\s+update.*from\s+public\.course_coupons' THEN
    RAISE EXCEPTION
      'finalize_course_coupon_reservation ja nao trava a reserva antes do cupom. Abortando em vez de sobrescrever uma definicao desconhecida.';
  END IF;
END;
$preflight$;

create or replace function public.finalize_course_coupon_reservation(
  p_order_id text
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coupon_id uuid;
  v_status text;
  v_reservation public.course_coupon_reservations%rowtype;
begin
  -- Leitura sem lock so para saber qual cupom travar. 'redeemed' e final
  -- (release so mexe em 'reserved'), entao sair cedo aqui e seguro.
  select coupon_id, status into v_coupon_id, v_status
    from public.course_coupon_reservations
   where order_id = p_order_id;
  if not found or v_status = 'redeemed' then
    return;
  end if;

  -- Cupom antes da reserva: a mesma ordem de reserve_course_coupon.
  perform 1
    from public.course_coupons
   where id = v_coupon_id
     for update;

  -- Reconfere com o lock: outra transacao pode ter resgatado ou soltado a
  -- reserva entre a leitura acima e o lock do cupom.
  select * into v_reservation
    from public.course_coupon_reservations
   where order_id = p_order_id
     for update;
  if not found or v_reservation.status = 'redeemed' then
    return;
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'COUPON_RESERVATION_RELEASED';
  end if;
  if v_reservation.coupon_id <> v_coupon_id then
    raise exception 'COUPON_RESERVATION_CONFLICT';
  end if;

  update public.course_coupons
     set redeemed_count = redeemed_count + 1,
         updated_at = now()
   where id = v_coupon_id;

  update public.course_coupon_reservations
     set status = 'redeemed',
         updated_at = now()
   where order_id = p_order_id;
end;
$function$;

create or replace function public.close_unpaid_course_order(
  p_order_id text,
  p_session_id text,
  p_status text,
  p_connected_account_id text
) returns text
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
  v_reservation_status text;
begin
  if p_status is null or p_status not in ('failed', 'cancelled') then
    raise exception 'ORDER_CLOSE_STATUS_INVALID';
  end if;

  -- Tudo abaixo decide sobre a linha commitada, travada ate o fim.
  select * into v_order
    from public.orders
   where id = p_order_id
     for update;
  -- Id que nao existe: nada a fechar.
  if not found then
    return 'missing';
  end if;

  -- A mesma amarracao de sessionBelongsToOrder no webhook, agora na linha
  -- travada. Divergencia e erro, para o Stripe tentar de novo.
  if coalesce(v_order.checkout_session_id, '') = ''
     or v_order.checkout_session_id <> coalesce(p_session_id, '')
     or not coalesce(
       case
         when v_order.payout_model = 'direct_charge' then
           coalesce(v_order.teacher_stripe_connected_account_id, '') <> ''
           and p_connected_account_id = v_order.teacher_stripe_connected_account_id
         when v_order.payout_model in ('separate_charges_and_transfers', 'destination_charge') then
           p_connected_account_id is null
         else false
       end,
       false
     ) then
    raise exception 'CHECKOUT_ORDER_MISMATCH';
  end if;

  -- Pago ou reembolsado nunca desce, e o lock dele fica com quem liquida.
  if v_order.status not in ('pending', 'failed', 'cancelled') then
    return 'settled';
  end if;

  -- Reserva ja resgatada com o pedido ainda sem paid: o caminho antigo
  -- resgatava o cupom antes de marcar o pedido. E liquidacao em curso, nao
  -- abandono: nada muda e o lock fica.
  select status into v_reservation_status
    from public.course_coupon_reservations
   where order_id = p_order_id
     for update;
  if v_reservation_status = 'redeemed' then
    return 'settling';
  end if;

  -- So 'reserved' vira 'released'.
  perform public.release_course_coupon_reservation(p_order_id);

  -- So o lock DESTE pedido. Um checkout mais novo do mesmo aluno e curso tem
  -- outra order_id e sobrevive.
  if v_order.course_id is not null then
    delete from public.checkout_locks
     where lock_key = v_order.user_id || '__' || v_order.course_id
       and order_id = p_order_id;
  end if;

  update public.orders
     set status = p_status,
         updated_at = now()
   where id = p_order_id;

  return 'closed';
end;
$function$;

create or replace function public.settle_paid_course_order(
  p_order_id text,
  p_session_id text,
  p_payment_intent_id text,
  p_connected_account_id text,
  p_receipt_url text
) returns text
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if coalesce(p_payment_intent_id, '') = '' then
    raise exception 'ORDER_PAYMENT_IDENTITY_MISSING';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
     for update;
  if not found then
    raise exception 'CHECKOUT_ORDER_NOT_FOUND';
  end if;

  if coalesce(v_order.checkout_session_id, '') = ''
     or v_order.checkout_session_id <> coalesce(p_session_id, '')
     or not coalesce(
       case
         when v_order.payout_model = 'direct_charge' then
           coalesce(v_order.teacher_stripe_connected_account_id, '') <> ''
           and p_connected_account_id = v_order.teacher_stripe_connected_account_id
         when v_order.payout_model in ('separate_charges_and_transfers', 'destination_charge') then
           p_connected_account_id is null
         else false
       end,
       false
     ) then
    raise exception 'CHECKOUT_ORDER_MISMATCH';
  end if;

  -- O dinheiro ja voltou: nada de ressuscitar o pedido.
  if v_order.status in ('refunded', 'partially_refunded') then
    return 'refunded';
  end if;

  -- Repeticao: paid_at e o pagamento gravados ficam. Outro pagamento para o
  -- mesmo pedido e contradicao, nao repeticao.
  if v_order.status = 'paid' then
    if coalesce(v_order.payment_intent_id, '') <> ''
       and v_order.payment_intent_id <> p_payment_intent_id then
      raise exception 'ORDER_PAYMENT_CONFLICT';
    end if;
    return 'paid';
  end if;

  -- Fechado antes de o pagamento chegar: o cupom ja foi solto. Quem chama
  -- alerta e tenta de novo; aqui nada muda.
  if v_order.status in ('failed', 'cancelled') then
    return 'closed';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'ORDER_STATUS_UNEXPECTED';
  end if;

  -- pedido (ja travado) -> cupom -> reserva.
  perform public.finalize_course_coupon_reservation(p_order_id);

  update public.orders
     set status = 'paid',
         checkout_session_id = p_session_id,
         payment_intent_id = p_payment_intent_id,
         receipt_url = coalesce(p_receipt_url, receipt_url),
         paid_at = now(),
         updated_at = now()
   where id = p_order_id;

  return 'settled';
end;
$function$;

revoke all on function public.finalize_course_coupon_reservation(text)
  from public, anon, authenticated;
grant execute on function public.finalize_course_coupon_reservation(text)
  to service_role;
revoke all on function public.close_unpaid_course_order(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.close_unpaid_course_order(text, text, text, text)
  to service_role;
revoke all on function public.settle_paid_course_order(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_paid_course_order(text, text, text, text, text)
  to service_role;

comment on function public.close_unpaid_course_order(text, text, text, text) is
  'Fecha (failed/cancelled) um pedido avulso nao pago: solta o cupom reservado, '
  'apaga so o lock deste pedido e grava o status, tudo com o pedido travado.';
comment on function public.settle_paid_course_order(text, text, text, text, text) is
  'Resgata o cupom e marca o pedido avulso paid com o pedido travado. Nunca '
  'rebaixa reembolso, nunca reabre pedido fechado, recusa outro pagamento.';

DO $verify$
DECLARE
  v_fn text;
  v_role text;
BEGIN
  IF pg_get_functiondef('public.finalize_course_coupon_reservation(text)'::regprocedure)
     !~* 'from\s+public\.course_coupons\s+where\s+id\s*=\s*v_coupon_id\s+for\s+update.*from\s+public\.course_coupon_reservations\s+where\s+order_id\s*=\s*p_order_id\s+for\s+update' THEN
    RAISE EXCEPTION 'finalize_course_coupon_reservation continua travando a reserva antes do cupom.';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.finalize_course_coupon_reservation(text)',
    'public.close_unpaid_course_order(text, text, text, text)',
    'public.settle_paid_course_order(text, text, text, text, text)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% nao pode ser executavel por %.', v_fn, v_role;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role precisa executar %.', v_fn;
    END IF;
  END LOOP;
END;
$verify$;

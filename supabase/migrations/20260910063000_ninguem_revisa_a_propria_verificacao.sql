-- Ops aprovava a própria verificação de criador.
--
-- review_creator_verification conferia o papel (ops ou admin), a decisão e o
-- estado do caso, mas não de quem era o caso. Uma conta ops com pedido de
-- verificação pendente aprovava o próprio pedido e virava criadora verificada
-- sem ninguém olhar. P2-7 da auditoria de permissões de 10/09.
--
-- Agora ninguém decide o próprio caso, admin incluído: separação de funções
-- é a regra da fila de verificação. O corpo é o de produção em 10/09 (lido por
-- pg_get_functiondef, só leitura), com a recusa logo depois de o caso ser
-- carregado e travado. Mesma assinatura; CREATE OR REPLACE mantém os grants.
-- Os trechos que o smoke de 20260910020000 confere (trava do usuário e depois
-- do caso) continuam iguais.

CREATE OR REPLACE FUNCTION public.review_creator_verification(p_case_id uuid, p_status text, p_review_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_trusted text := current_setting('skillset.trusted_write', true);
  v_uid text := (select auth.uid())::text;
  v_case public.creator_verification_cases%rowtype;
  v_note text := nullif(btrim(coalesce(p_review_note,'')), '');
BEGIN
  PERFORM public.require_strong_session();
  if v_uid is null or not (public.is_ops() or public.is_admin()) then
    raise exception 'Only the operations team can review verification cases.';
  end if;
  if p_status not in ('approved','needs_changes','rejected') then
    raise exception 'Invalid review decision.';
  end if;
  if p_status <> 'approved' and (v_note is null or char_length(v_note) < 12) then
    raise exception 'Add a review note (at least 12 characters) when requesting changes or rejecting.';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Keep the review note under 2000 characters.';
  end if;

  perform 1 from public.users where uid = (select creator_id from public.creator_verification_cases where id = p_case_id) for update;
  select * into v_case from public.creator_verification_cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'Verification case not found.';
  end if;
  if v_case.creator_id = v_uid then
    raise exception 'You cannot review your own verification case.' using errcode = '42501';
  end if;
  if v_case.status <> 'pending' then
    raise exception 'Only pending cases can be reviewed.';
  end if;

  update public.creator_verification_cases
    set status = p_status,
        review_note = v_note,
        reviewed_by = v_uid,
        reviewed_at = now(),
        updated_at = now()
  where id = p_case_id;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.users
    set creator_verification_status = p_status, updated_at = now()
  where uid = v_case.creator_id;
  perform set_config('skillset.trusted_write', coalesce(v_trusted, ''), true);

  return jsonb_build_object('success', true);
end;
$function$;

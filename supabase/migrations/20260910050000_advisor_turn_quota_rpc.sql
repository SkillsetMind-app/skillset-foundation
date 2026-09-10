-- Sofria: o Advisor limita a conversa a 30 perguntas por hora e 120 por dia,
-- mas so na rota POST /api/teach/advisor. advisor_conversations e
-- advisor_messages davam INSERT direto a `authenticated` (policy de dono +
-- sessao forte), entao qualquer conta logada, professor ou nao, gravava
-- conversas e mensagens proprias pelo PostgREST sem cota nenhuma. Auditoria de
-- privacidade de 2026-09-10, item 3.
--
-- Conserto: a gravacao ganha uma porta so, save_advisor_turn. Ela exige sessao
-- forte e papel de professor, confere o dono da conversa informada e aplica a
-- mesma cota do POST no proprio banco. O INSERT direto sai dos papeis da API.
-- SELECT nao muda: o GET da rota continua lendo o historico pela RLS de dono.
--
-- Baldes proprios (advisor_turn_*), nao os da rota (advisor_*): a rota gasta
-- os dela ANTES de chamar o modelo, e reusar a mesma chave contaria cada
-- pergunta duas vezes, cortando a cota real pela metade. O FOR UPDATE dentro de
-- enforce_rate_limit serializa chamadas simultaneas do mesmo professor, entao a
-- cota nao fura em rajada. Qualquer recusa desfaz a transacao inteira,
-- inclusive o consumo da cota.

create function public.save_advisor_turn(
  p_conversation_id uuid,
  p_title text,
  p_question text,
  p_reply text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_conversation_id;
begin
  perform public.require_strong_session();
  if v_uid is null or not public.is_teacher() then
    raise exception 'Teacher access is required.' using errcode = '42501';
  end if;

  if v_id is not null and not exists (
    select 1 from public.advisor_conversations c
    where c.id = v_id and c.teacher_id = v_uid
  ) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;

  perform public.enforce_rate_limit('advisor_turn_' || v_uid, 30, 3600000);
  perform public.enforce_rate_limit('advisor_turn_daily_' || v_uid, 120, 86400000);

  if v_id is null then
    insert into public.advisor_conversations (teacher_id, title)
    values (v_uid, p_title)
    returning id into v_id;
  end if;

  -- O limite de 8000 caracteres por mensagem continua na constraint da tabela.
  insert into public.advisor_messages (conversation_id, role, content)
  values (v_id, 'user', p_question), (v_id, 'assistant', p_reply);

  return v_id;
end;
$$;

revoke all on function public.save_advisor_turn(uuid, text, text, text) from public, anon;
grant execute on function public.save_advisor_turn(uuid, text, text, text) to authenticated;

-- A funcao acima ja existe quando o INSERT sai: nao ha instante, dentro desta
-- migration, sem caminho de gravacao.
revoke insert on public.advisor_conversations, public.advisor_messages
  from public, anon, authenticated;

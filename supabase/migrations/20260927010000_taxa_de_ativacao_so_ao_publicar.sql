-- A taxa única de ativação passa a ser cobrada ao PUBLICAR, não ao entrar no
-- estúdio.
--
-- Até aqui (20260810030000) o gatilho courses_creator_activation_gate barrava
-- qualquer INSERT/UPDATE do criador no próprio curso enquanto
-- creator_activation_blocked() fosse verdadeiro: sem pagar, não havia nem
-- rascunho. Agora o criador monta o curso inteiro (rascunho, módulos, aulas,
-- vídeo) e conecta a Stripe sem pagar; a taxa é exigida no primeiro Publicar.
--
-- O que muda no banco:
--
-- 1. enforce_creator_activation() só recusa a passagem para 'published' feita
--    pelo próprio dono. Rascunho, edição e edição de curso já publicado passam.
--    publish_teacher_course (20260915010000) continua sendo a porta de verdade
--    e recusa antes com a mesma frase; o gatilho fica como segunda tranca para
--    qualquer caminho que escreva status sem passar pela RPC.
--
-- 2. claim_welcome_tour() deixa de adiar o tour do criador sem ativação. O
--    adiamento existia porque o estúdio ficava atrás do muro; sem muro, o tour
--    aparece na primeira visita, como para quem pagou.
--
-- Continua igual, de propósito: publicar, loja pública (20260910065000),
-- cupom, acesso manual e domínio próprio (20260910066500) seguem exigindo a
-- ativação. Tudo isso é venda ou exposição pública, que só existe depois de
-- publicar.
--
-- Mesmas assinaturas: create or replace mantém dono, grants e comentário.

create or replace function public.enforce_creator_activation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Only the creator publishing their OWN course is gated. Drafting, editing
  -- and saving an already-published course pass. A student-triggered counter
  -- update or a service-role webhook has a different (or null) uid and passes.
  if new.owner_id is not null
     and new.owner_id = (select auth.uid())::text
     and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and public.creator_activation_blocked(new.owner_id) then
    -- Wording is load-bearing: the builder matches on "activation fee" to
    -- show the checkout link. Same sentence as publish_teacher_course.
    raise exception 'Pay the one-time activation fee before publishing your first course.';
  end if;
  return new;
end;
$$;

create or replace function public.claim_welcome_tour(p_uid text, p_surface text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare claimed boolean := false;
begin
  perform public.require_strong_session();
  if auth.uid() is null or p_uid is distinct from auth.uid()::text then
    raise exception 'The current account is required.' using errcode = '42501';
  end if;
  if p_surface is null or p_surface not in ('student', 'teacher') then
    raise exception 'Unknown welcome surface.' using errcode = '22023';
  end if;

  -- One conditional UPDATE is the reservation: a concurrent caller rechecks
  -- the NULL condition after taking the row lock and cannot also win.
  update public.users set welcome_tour_seen_at = now()
  where uid = p_uid and onboarding_completed and welcome_tour_seen_at is null
  returning true into claimed;
  return coalesce(claimed, false);
end $$;

-- Quem responde, avisa.
--
-- O que a pessoa sofria (auditoria de 06/10):
--   * o professor nunca sabia de uma pergunta nova na comunidade do curso;
--   * o aluno nunca sabia que a pergunta dele tinha resposta;
--   * a resposta do suporte só aparecia se a pessoa reabrisse /support;
--   * nenhum aviso (nem a mensagem do professor) chegava por e-mail.
--
-- Os tipos community_comment e community_reply existiam no app, mas nada os
-- criava. Agora três triggers criam os avisos:
--   community_question  pergunta nova -> dono do curso
--   community_comment   resposta num post -> autor do post
--   community_reply     resposta num post -> quem já respondeu naquele post
--   support_reply       resposta do suporte -> dono do ticket
-- Quem escreveu a resposta nunca recebe aviso dela, e cada pessoa recebe no
-- máximo um aviso por resposta (o autor do post que também comentou recebe só
-- o community_comment).
--
-- Texto: estes avisos não gravam frase em inglês. title fica vazio, body leva
-- só o que a própria pessoa escreveu (título da pergunta, trecho da resposta,
-- assunto do ticket) e params leva os ids. A frase é montada no idioma de quem
-- lê (src/components/account/notification-row.tsx).
--
-- E-mail: emailed_at marca o que já saiu no resumo de hora em hora
-- (src/app/api/cron/notification-digest). Só a service role grava.

alter table public.notifications
  add column if not exists params jsonb,
  add column if not exists emailed_at timestamptz;

comment on column public.notifications.params is
  'Ids do evento (postId, commentId, ticketId...) para a tela montar o texto traduzido. Nulo nos tipos antigos.';
comment on column public.notifications.emailed_at is
  'Quando o aviso saiu no resumo por e-mail. Nulo = nunca enviado. Só a service role grava.';

-- O cliente continua mudando só `read`: params e emailed_at entram na trava.
create or replace function public.notifications_client_read_only_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.is_service_role() then
    return new;
  end if;
  if new.notification_id is distinct from old.notification_id
     or new.user_id    is distinct from old.user_id
     or new.type       is distinct from old.type
     or new.title      is distinct from old.title
     or new.body       is distinct from old.body
     or new.link       is distinct from old.link
     or new.actor_name is distinct from old.actor_name
     or new.params     is distinct from old.params
     or new.emailed_at is distinct from old.emailed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'notifications: clients may only modify the read flag';
  end if;
  return new;
end;
$function$;

-- A fila do resumo: não lidas e nunca enviadas, da mais antiga para a nova.
create index if not exists idx_notifications_digest_due
  on public.notifications (created_at)
  where read = false and emailed_at is null;

-- ---------------------------------------------------------------------------
-- Comunidade
-- ---------------------------------------------------------------------------
--
-- course_slug guarda o id OU o slug do curso (cursos publicados usam o id): o
-- mesmo casamento das policies de leitura do dono (20260902160000). O dono do
-- curso não tem matrícula, então o link dele é a caixa de entrada da
-- comunidade no estúdio; o de todo mundo é a própria pergunta na sala.

create or replace function public.notify_course_owner_on_question()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_course_id text;
  v_owner_id text;
begin
  if new.category <> 'question' then
    return new;
  end if;

  select c.id, c.owner_id into v_course_id, v_owner_id
  from public.courses c
  where c.id = new.course_slug or c.slug = new.course_slug
  order by (c.id = new.course_slug) desc
  limit 1;

  if v_owner_id is null or v_owner_id = new.author_id then
    return new;
  end if;

  -- Um aviso que falha nunca derruba a pergunta.
  begin
    insert into public.notifications
      (notification_id, user_id, type, title, body, read, link, actor_name, params, created_at)
    select
      gen_random_uuid()::text,
      u.uid,
      'community_question',
      '',
      left(coalesce(nullif(btrim(new.title), ''), new.body), 140),
      false,
      '/teach/courses/' || v_course_id || '/community',
      new.author_name,
      jsonb_build_object('postId', new.id, 'courseId', v_course_id),
      now()
    from public.users u
    where u.uid = v_owner_id;
  exception when others then
    raise warning 'notify_course_owner_on_question: %', sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.notify_on_community_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post public.community_posts%rowtype;
  v_course_id text;
  v_owner_id text;
begin
  select * into v_post from public.community_posts where id = new.post_id;
  if not found then
    return new;
  end if;

  select c.id, c.owner_id into v_course_id, v_owner_id
  from public.courses c
  where c.id = v_post.course_slug or c.slug = v_post.course_slug
  order by (c.id = v_post.course_slug) desc
  limit 1;

  begin
    insert into public.notifications
      (notification_id, user_id, type, title, body, read, link, actor_name, params, created_at)
    select
      gen_random_uuid()::text,
      r.user_id,
      case when r.user_id = v_post.author_id then 'community_comment' else 'community_reply' end,
      '',
      left(new.body, 140),
      false,
      case when r.user_id = v_owner_id
        then '/teach/courses/' || v_course_id || '/community'
        else '/learn/courses/' || v_post.course_slug || '/community/q/' || v_post.id
      end,
      new.author_name,
      jsonb_build_object('postId', v_post.id, 'commentId', new.id, 'category', v_post.category),
      now()
    -- union (não union all): uma pessoa, um aviso.
    from (
      select v_post.author_id as user_id
      union
      select c.author_id
      from public.community_comments c
      where c.post_id = new.post_id and c.id <> new.id
    ) r
    join public.users u on u.uid = r.user_id
    where r.user_id <> new.author_id;
  exception when others then
    raise warning 'notify_on_community_comment: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suporte
-- ---------------------------------------------------------------------------
--
-- A resposta mora em support_tickets.admin_response (respondToSupportTicket).
-- Cada texto novo é uma resposta nova; regravar o mesmo texto não avisa.

create or replace function public.notify_ticket_owner_on_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(new.admin_response, '')), '') is null
     or new.admin_response is not distinct from old.admin_response
     or new.responded_by is not distinct from new.user_id then
    return new;
  end if;

  begin
    insert into public.notifications
      (notification_id, user_id, type, title, body, read, link, actor_name, params, created_at)
    select
      gen_random_uuid()::text,
      u.uid,
      'support_reply',
      '',
      left(new.subject, 140),
      false,
      '/support',
      null,
      jsonb_build_object('ticketId', new.id),
      now()
    from public.users u
    where u.uid = new.user_id;
  exception when others then
    raise warning 'notify_ticket_owner_on_support_reply: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists community_posts_notify_question on public.community_posts;
create trigger community_posts_notify_question
  after insert on public.community_posts
  for each row execute function public.notify_course_owner_on_question();

drop trigger if exists community_comments_notify_thread on public.community_comments;
create trigger community_comments_notify_thread
  after insert on public.community_comments
  for each row execute function public.notify_on_community_comment();

drop trigger if exists support_tickets_notify_reply on public.support_tickets;
create trigger support_tickets_notify_reply
  after update of admin_response on public.support_tickets
  for each row
  when (new.admin_response is distinct from old.admin_response)
  execute function public.notify_ticket_owner_on_support_reply();

-- Mesmo ACL das outras funções de trigger: só o dono e a service role.
revoke all on function
  public.notify_course_owner_on_question(),
  public.notify_on_community_comment(),
  public.notify_ticket_owner_on_support_reply()
from public, anon, authenticated;
grant execute on function
  public.notify_course_owner_on_question(),
  public.notify_on_community_comment(),
  public.notify_ticket_owner_on_support_reply()
to service_role;

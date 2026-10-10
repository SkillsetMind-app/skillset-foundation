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
-- o community_comment). Só recebe aviso de resposta quem ainda pode ler a
-- comunidade: o dono do curso ou quem tem matrícula ativa ou concluída.
--
-- Texto: estes avisos não gravam frase em inglês. title fica vazio, body leva
-- só o que a própria pessoa escreveu (título da pergunta, trecho da resposta,
-- assunto do ticket) e params leva os ids. A frase é montada no idioma de quem
-- lê (src/components/account/notification-row.tsx). O nome de quem escreveu
-- vem do perfil (users.display_name), nunca do author_name mandado pelo
-- cliente; o próprio author_name passa a ser derivado do perfil no insert.
--
-- Conteúdo apagado ou editado: apagar a pergunta ou a resposta apaga os avisos
-- dela; editar o texto atualiza o trecho guardado no aviso, sem avisar de novo.
--
-- E-mail: emailed_at marca o que já saiu no resumo de hora em hora
-- (src/app/api/cron/notification-digest). Quem e o quê sai no resumo é decidido
-- aqui, em claim_notification_digests, que também marca as linhas. Só a
-- service role chama e grava.

alter table public.notifications
  add column if not exists params jsonb,
  add column if not exists emailed_at timestamptz;

comment on column public.notifications.params is
  'Ids do evento (postId, commentId, ticketId...) para a tela montar o texto traduzido. Nulo nos tipos antigos.';
comment on column public.notifications.emailed_at is
  'Quando o aviso saiu no resumo por e-mail. Nulo = nunca enviado. Só a service role grava.';

-- O cliente continua mudando só `read`: params e emailed_at entram na trava.
-- A escrita confiável (skillset.trusted_write, ligada só dentro de função
-- SECURITY DEFINER) atualiza o trecho quando a resposta é editada.
create or replace function public.notifications_client_read_only_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if public.is_service_role() or current_setting('skillset.trusted_write', true) = 'on' then
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

-- Apagar ou editar uma pergunta ou resposta acha os avisos dela por aqui.
create index if not exists idx_notifications_params_post
  on public.notifications ((params->>'postId'));

-- ---------------------------------------------------------------------------
-- Comunidade
-- ---------------------------------------------------------------------------
--
-- course_slug guarda o id OU o slug do curso (cursos publicados usam o id): o
-- mesmo casamento das policies de leitura do dono (20260902160000). O dono do
-- curso não tem matrícula, então o link dele é a caixa de entrada da
-- comunidade no estúdio; o de todo mundo é a própria pergunta na sala.

-- author_role já vinha do perfil; author_name passa a vir também, no insert.
-- No update ele fica como está: a trava de campos dos posts e comentários
-- recusa mudar author_name, e o nome de quem já escreveu não é reescrito.
create or replace function public.set_community_author_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select coalesce(u.roles->>0, 'student'),
         coalesce(nullif(btrim(u.display_name), ''), 'SkillsetMind member')
    into new.author_role, v_name
  from public.users u
  where u.uid = new.author_id;
  new.author_role := coalesce(new.author_role, 'student');
  if tg_op = 'INSERT' and v_name is not null then
    new.author_name := v_name;
  end if;
  return new;
end;
$$;
revoke all on function public.set_community_author_role() from public, anon, authenticated;

create or replace function public.notify_course_owner_on_question()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_course_id text;
  v_owner_id text;
  v_actor text;
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

  select nullif(btrim(u.display_name), '') into v_actor
  from public.users u where u.uid = new.author_id;

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
      coalesce(v_actor, 'SkillsetMind member'),
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
  v_actor text;
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

  select nullif(btrim(u.display_name), '') into v_actor
  from public.users u where u.uid = new.author_id;

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
      coalesce(v_actor, 'SkillsetMind member'),
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
    where r.user_id <> new.author_id
      -- Quem perdeu o acesso (reembolso, revogação, expiração) não recebe o
      -- trecho de uma conversa que a RLS já não deixa ler.
      and (r.user_id = v_owner_id
        or exists (
          select 1 from public.enrollments e
          where e.user_id = r.user_id and e.course_id = v_course_id
            and e.status in ('active', 'completed')));
  exception when others then
    raise warning 'notify_on_community_comment: %', sqlerrm;
  end;

  return new;
end;
$$;

-- Apagou a pergunta ou a resposta: os avisos dela somem do sino. Editou o
-- texto: o trecho guardado acompanha, lido ou não, sem criar aviso novo.
create or replace function public.sync_notifications_with_community_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trusted text := current_setting('skillset.trusted_write', true);
begin
  begin
    if tg_op = 'DELETE' then
      if tg_table_name = 'community_posts' then
        delete from public.notifications where params->>'postId' = old.id;
      else
        delete from public.notifications
        where params->>'postId' = old.post_id and params->>'commentId' = old.id;
      end if;
      return old;
    end if;

    perform set_config('skillset.trusted_write', 'on', true);
    if tg_table_name = 'community_posts' then
      update public.notifications
        set body = left(coalesce(nullif(btrim(new.title), ''), new.body), 140)
      where params->>'postId' = new.id and type = 'community_question';
    else
      update public.notifications
        set body = left(new.body, 140)
      where params->>'postId' = new.post_id and params->>'commentId' = new.id;
    end if;
    perform set_config('skillset.trusted_write', coalesce(v_trusted, 'off'), true);
  exception when others then
    raise warning 'sync_notifications_with_community_content: %', sqlerrm;
  end;
  return coalesce(new, old);
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

drop trigger if exists community_posts_forget_notifications on public.community_posts;
create trigger community_posts_forget_notifications
  after delete on public.community_posts
  for each row execute function public.sync_notifications_with_community_content();

drop trigger if exists community_comments_forget_notifications on public.community_comments;
create trigger community_comments_forget_notifications
  after delete on public.community_comments
  for each row execute function public.sync_notifications_with_community_content();

drop trigger if exists community_posts_sync_notifications on public.community_posts;
create trigger community_posts_sync_notifications
  after update of title, body on public.community_posts
  for each row
  when (new.title is distinct from old.title or new.body is distinct from old.body)
  execute function public.sync_notifications_with_community_content();

drop trigger if exists community_comments_sync_notifications on public.community_comments;
create trigger community_comments_sync_notifications
  after update of body on public.community_comments
  for each row
  when (new.body is distinct from old.body)
  execute function public.sync_notifications_with_community_content();

drop trigger if exists support_tickets_notify_reply on public.support_tickets;
create trigger support_tickets_notify_reply
  after update of admin_response on public.support_tickets
  for each row
  when (new.admin_response is distinct from old.admin_response)
  execute function public.notify_ticket_owner_on_support_reply();

-- ---------------------------------------------------------------------------
-- Resumo por e-mail
-- ---------------------------------------------------------------------------
--
-- Escolhe e marca, num comando só, quem recebe o resumo agora:
--   * avisos não lidos, nunca enviados, de 10 minutos a 3 dias de idade;
--   * fora quem desligou o resumo (preferences.notifications.emailDigest =
--     false), quem está suspenso (account_controls), conta apagada, banida ou
--     sem e-mail confirmado, e quem recebeu um resumo na última hora;
--   * no máximo p_limit pessoas (teto 100), a de aviso mais antigo primeiro.
-- Quem não pode receber é filtrado ANTES do limite, então nunca segura a fila
-- de quem pode. As linhas escolhidas ganham emailed_at no mesmo comando, com
-- `for update skip locked`: duas execuções simultâneas nunca devolvem o mesmo
-- aviso. Devolve o e-mail e o idioma da conta para a rota enviar sem consultar
-- a Auth de novo.

create or replace function public.claim_notification_digests(p_limit integer)
returns table (
  user_id text,
  email text,
  locale text,
  notification_ids text[],
  notification_count integer
)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select n.user_id, min(n.created_at) as oldest
    from public.notifications n
    join public.users u on u.uid = n.user_id
    join auth.users a on a.id::text = n.user_id
    where n.read = false
      and n.emailed_at is null
      and n.created_at <= now() - interval '10 minutes'
      and n.created_at >= now() - interval '3 days'
      and coalesce(u.preferences->'notifications'->>'emailDigest', '') <> 'false'
      and a.email is not null
      and a.email_confirmed_at is not null
      and a.deleted_at is null
      and (a.banned_until is null or a.banned_until <= now())
      and not exists (
        select 1 from public.account_controls ac
        where ac.uid = n.user_id and ac.suspended)
      and not exists (
        select 1 from public.notifications r
        where r.user_id = n.user_id and r.emailed_at > now() - interval '1 hour')
    group by n.user_id
    order by min(n.created_at), n.user_id
    limit least(p_limit, 100)
  ),
  locked as (
    select n.notification_id
    from public.notifications n
    join candidates c on c.user_id = n.user_id
    where n.read = false
      and n.emailed_at is null
      and n.created_at <= now() - interval '10 minutes'
      and n.created_at >= now() - interval '3 days'
    for update of n skip locked
  ),
  claimed as (
    update public.notifications n
      set emailed_at = now()
    from locked l
    where n.notification_id = l.notification_id
    returning n.user_id, n.notification_id
  )
  select cl.user_id,
         a.email::text,
         a.raw_user_meta_data->>'locale',
         array_agg(cl.notification_id order by cl.notification_id),
         count(*)::integer
  from claimed cl
  join auth.users a on a.id::text = cl.user_id
  group by cl.user_id, a.email, a.raw_user_meta_data->>'locale';
$$;

-- Mesmo ACL das outras funções de trigger: só o dono e a service role.
revoke all on function
  public.notify_course_owner_on_question(),
  public.notify_on_community_comment(),
  public.notify_ticket_owner_on_support_reply(),
  public.sync_notifications_with_community_content(),
  public.claim_notification_digests(integer)
from public, anon, authenticated;
grant execute on function
  public.notify_course_owner_on_question(),
  public.notify_on_community_comment(),
  public.notify_ticket_owner_on_support_reply(),
  public.sync_notifications_with_community_content(),
  public.claim_notification_digests(integer)
to service_role;

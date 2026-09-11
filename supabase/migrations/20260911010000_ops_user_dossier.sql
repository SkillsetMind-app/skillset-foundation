-- Ops, a pessoa inteira: uma projecao para a lista e uma para o dossie.
-- So leitura. So admin ativo com 2FA (aal2), o mesmo portao do controle de
-- conta do #326. Devolvem identificadores, respostas do cadastro, contagens e
-- datas; nunca credencial, conversa privada (Advisor, mensagens) ou arquivo.
-- A aba Usuarios deixa de ler public.users inteira pelo navegador.

create or replace function public.admin_search_users(
  p_search text default null,
  p_status text default null,
  p_role text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  uid text,
  email text,
  display_name text,
  roles jsonb,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  suspended boolean,
  blocked boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if auth.uid() is null or not public.is_admin()
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'OPS_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  if (p_status is not null and p_status not in ('active', 'suspended', 'blocked'))
    or (p_role is not null and p_role not in ('student', 'teacher', 'admin', 'support', 'moderator', 'ops')) then
    raise exception 'USER_SEARCH_INVALID_FILTER' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select u.uid, u.email, u.display_name,
      coalesce(u.roles, '[]'::jsonb) as roles,
      u.created_at, a.last_sign_in_at,
      coalesce(c.suspended, false) as suspended,
      c.blocked_email is not null as blocked
    from public.users u
    left join auth.users a on a.id::text = u.uid
    left join public.account_controls c on c.uid = u.uid
    where (v_search is null
        or u.email ilike '%' || v_search || '%'
        or u.display_name ilike '%' || v_search || '%'
        or u.uid = v_search)
      and (p_role is null or coalesce(u.roles, '[]'::jsonb) ? p_role)
  )
  select f.uid, f.email, f.display_name, f.roles, f.created_at, f.last_sign_in_at,
    f.suspended, f.blocked, count(*) over ()
  from filtered f
  where p_status is null
    or (p_status = 'active' and not f.suspended)
    or (p_status = 'suspended' and f.suspended and not f.blocked)
    or (p_status = 'blocked' and f.blocked)
  order by f.created_at desc nulls last, f.uid
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;
revoke all on function public.admin_search_users(text, text, text, int, int) from public, anon, service_role;
grant execute on function public.admin_search_users(text, text, text, int, int) to authenticated;

create or replace function public.admin_get_user_dossier(p_uid text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user public.users;
  v_access jsonb;
  v_last_sign_in timestamptz;
  v_since timestamptz := now() - interval '30 days';
begin
  if auth.uid() is null or not public.is_admin()
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'OPS_ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  select * into v_user from public.users u where u.uid = p_uid;
  if not found then
    raise exception 'USER_DOSSIER_USER_MISSING' using errcode = '23503';
  end if;

  -- Sessoes contadas a partir do ultimo corte do #326; sem controle, todas.
  select jsonb_build_object(
      'email_confirmed_at', a.email_confirmed_at,
      'last_sign_in_at', a.last_sign_in_at,
      'providers', coalesce((select jsonb_agg(distinct i.provider)
        from auth.identities i where i.user_id = a.id), '[]'::jsonb),
      'verified_factors', (select count(*) from auth.mfa_factors f
        where f.user_id = a.id and f.status = 'verified'),
      'sessions_since_cutoff', (select count(*) from auth.sessions s
        where s.user_id = a.id
          and s.created_at > coalesce(c.sessions_revoked_before, '-infinity'::timestamptz)),
      'suspended', coalesce(c.suspended, false),
      'blocked_email', c.blocked_email,
      'sessions_revoked_before', c.sessions_revoked_before),
    a.last_sign_in_at
  into v_access, v_last_sign_in
  from (select 1) as one
  left join auth.users a on a.id::text = p_uid
  left join public.account_controls c on c.uid = p_uid;

  return jsonb_build_object(
    'identity', jsonb_build_object(
      'uid', v_user.uid, 'email', v_user.email, 'display_name', v_user.display_name,
      'username', v_user.username, 'photo_url', v_user.photo_url,
      'roles', coalesce(v_user.roles, '[]'::jsonb), 'created_at', v_user.created_at,
      'last_login_at', v_user.last_login_at, 'is_self', p_uid = auth.uid()::text),
    -- O formulario de entrada (/welcome e onboarding) e os aceites de termos.
    'onboarding', jsonb_build_object(
      'path', v_user.onboarding_path,
      'completed', v_user.onboarding_completed,
      'completed_at', v_user.onboarding_completed_at,
      'answers', coalesce(to_jsonb(v_user.onboarding_answers), '{}'::jsonb),
      'goals', to_jsonb(v_user.goals),
      'credentials', to_jsonb(v_user.credentials),
      'bio', v_user.bio,
      'phone_number', v_user.phone_number,
      'timezone', v_user.timezone,
      'marketing_consent', v_user.marketing_consent,
      'terms_accepted_at', v_user.terms_accepted_at,
      'terms_version', v_user.terms_version,
      'privacy_accepted_at', v_user.privacy_accepted_at,
      'privacy_version', v_user.privacy_version,
      'teacher_terms_accepted_at', v_user.teacher_terms_accepted_at,
      'teacher_terms_version', v_user.teacher_terms_version),
    'access', v_access,
    'learning', jsonb_build_object(
      'enrollments_by_status', coalesce((select jsonb_object_agg(coalesce(g.status, 'unknown'), g.n)
        from (select e.status, count(*) as n from public.enrollments e
          where e.user_id = p_uid group by e.status) g), '{}'::jsonb),
      'recent_enrollments', coalesce((select jsonb_agg(r order by r.created_at desc nulls last)
        from (select e.id, e.course_id, e.course_title, e.status, e.source, e.progress_percent, e.created_at
          from public.enrollments e where e.user_id = p_uid
          order by e.created_at desc nulls last limit 10) r), '[]'::jsonb),
      'certificates', (select count(*) from public.certificates ce where ce.user_id = p_uid),
      'course_subscriptions_by_status', coalesce((select jsonb_object_agg(coalesce(g.status, 'unknown'), g.n)
        from (select cs.status, count(*) as n from public.course_subscriptions cs
          where cs.user_id = p_uid group by cs.status) g), '{}'::jsonb)),
    -- Comportamento: so contagens e datas. Nunca o texto de mensagem privada
    -- nem de conversa com o Advisor.
    'behavior', jsonb_build_object(
      'last_activity_at', greatest(
        v_last_sign_in,
        v_user.last_login_at::timestamptz,
        (select max(lp.completed_at::timestamptz) from public.lesson_progress lp where lp.user_id = p_uid),
        (select max(pb.last_seen_at::timestamptz) from public.lesson_playback pb where pb.user_id = p_uid),
        (select max(p.created_at::timestamptz) from public.community_posts p where p.author_id = p_uid),
        (select max(cc.created_at::timestamptz) from public.community_comments cc where cc.author_id = p_uid),
        (select max(lc.created_at::timestamptz) from public.lesson_comments lc where lc.author_id = p_uid),
        (select max(m.created_at::timestamptz) from public.course_messages m where m.sender_id = p_uid)),
      'lessons_completed', (select count(*) from public.lesson_progress lp
        where lp.user_id = p_uid and lp.completed_at is not null),
      'lessons_opened', (select count(*) from public.lesson_playback pb where pb.user_id = p_uid),
      'messages_sent', (select count(*) from public.course_messages m where m.sender_id = p_uid),
      'wishlist', (select count(*) from public.wishlists w where w.user_id = p_uid),
      'points', (select ms.points from public.member_stats ms where ms.uid = p_uid),
      'level', (select ms.level from public.member_stats ms where ms.uid = p_uid),
      'last_30_days', jsonb_build_object(
        'lessons_completed', (select count(*) from public.lesson_progress lp
          where lp.user_id = p_uid and lp.completed_at::timestamptz >= v_since),
        'posts', (select count(*) from public.community_posts p
          where p.author_id = p_uid and p.created_at::timestamptz >= v_since),
        'comments', (select count(*) from public.community_comments cc
          where cc.author_id = p_uid and cc.created_at::timestamptz >= v_since),
        'lesson_comments', (select count(*) from public.lesson_comments lc
          where lc.author_id = p_uid and lc.created_at::timestamptz >= v_since),
        'messages', (select count(*) from public.course_messages m
          where m.sender_id = p_uid and m.created_at::timestamptz >= v_since)),
      'advisor', jsonb_build_object(
        'conversations', (select count(*) from public.advisor_conversations ac where ac.teacher_id = p_uid),
        'messages', (select count(*) from public.advisor_messages am
          join public.advisor_conversations ac on ac.id = am.conversation_id where ac.teacher_id = p_uid),
        'last_used_at', (select max(ac.updated_at::timestamptz)
          from public.advisor_conversations ac where ac.teacher_id = p_uid))),
    -- Linha do tempo: os 30 fatos mais recentes da pessoa, de varias tabelas.
    'timeline', coalesce((select jsonb_agg(ev order by ev.at desc) from (
        select u.kind, u.at, u.label from (
          (select 'course_created'::text, co.created_at::timestamptz, co.title::text
            from public.courses co where co.owner_id = p_uid
            order by co.created_at desc nulls last limit 10)
          union all
          (select 'enrolled', e.created_at::timestamptz, coalesce(e.course_title, e.course_id::text)
            from public.enrollments e where e.user_id = p_uid
            order by e.created_at desc nulls last limit 10)
          union all
          (select 'order', o.created_at::timestamptz, concat_ws(' - ', o.course_title, o.status)
            from public.orders o where o.user_id = p_uid
            order by o.created_at desc nulls last limit 10)
          union all
          (select 'lesson_completed', lp.completed_at::timestamptz, lp.lesson_id::text
            from public.lesson_progress lp where lp.user_id = p_uid and lp.completed_at is not null
            order by lp.completed_at desc limit 10)
          union all
          (select 'post', p.created_at::timestamptz, p.title::text
            from public.community_posts p where p.author_id = p_uid
            order by p.created_at desc nulls last limit 10)
          union all
          (select 'comment', cc.created_at::timestamptz, left(cc.body, 80)
            from public.community_comments cc where cc.author_id = p_uid
            order by cc.created_at desc nulls last limit 10)
          union all
          (select 'lesson_comment', lc.created_at::timestamptz, left(lc.body, 80)
            from public.lesson_comments lc where lc.author_id = p_uid
            order by lc.created_at desc nulls last limit 10)
          union all
          (select 'message', m.created_at::timestamptz, m.course_title::text
            from public.course_messages m where m.sender_id = p_uid
            order by m.created_at desc nulls last limit 10)
          union all
          (select 'ticket', t.created_at::timestamptz, t.subject::text
            from public.support_tickets t where t.user_id = p_uid
            order by t.created_at desc nulls last limit 10)
        ) as u(kind, at, label)
        where u.at is not null
        order by u.at desc
        limit 30) ev), '[]'::jsonb),
    'purchases', jsonb_build_object(
      'orders', coalesce((select jsonb_agg(g order by g.status, g.currency)
        from (select o.status, upper(o.currency) as currency, count(*) as n,
            coalesce(sum(o.amount_minor), 0) as amount_minor,
            coalesce(sum(o.refunded_amount_minor), 0) as refunded_minor
          from public.orders o where o.user_id = p_uid
          group by o.status, upper(o.currency)) g), '[]'::jsonb),
      'recent_orders', coalesce((select jsonb_agg(r order by r.created_at desc nulls last)
        from (select o.id, o.course_title, o.status, o.amount_minor, o.currency,
            o.refunded_amount_minor, o.created_at
          from public.orders o where o.user_id = p_uid
          order by o.created_at desc nulls last limit 10) r), '[]'::jsonb),
      'plan_subscription', (select to_jsonb(s) from (
          select sb.plan_id, sb.status, sb.current_period_end, sb.cancel_at_period_end
          from public.subscriptions sb where sb.user_id = p_uid
          order by sb.created_at desc nulls last limit 1) s),
      'stripe_customer_id', v_user.stripe_customer_id),
    'creator', jsonb_build_object(
      'verification_status', v_user.creator_verification_status,
      -- O formulario de admissao do criador. O documento fica no storage
      -- privado: aqui so se ele foi enviado.
      'verification_case', (select jsonb_build_object(
          'status', v.status, 'kind', v.verification_kind, 'profession', v.profession,
          'registration_type', v.registration_type, 'registration_region', v.registration_region,
          'registration_id', v.registration_id, 'evidence_links', to_jsonb(v.evidence_links),
          'note', v.note, 'has_document', v.document_path is not null,
          'created_at', v.created_at, 'reviewed_at', v.reviewed_at, 'review_note', v.review_note)
        from public.creator_verification_cases v where v.creator_id = p_uid
        order by v.created_at desc nulls last limit 1),
      'activation_fee_paid_at', v_user.activation_fee_paid_at,
      'activation_waiver', (select jsonb_build_object('granted_at', w.granted_at, 'ready_at', w.ready_at)
        from public.creator_activation_waivers w where w.uid = p_uid),
      'connect', jsonb_build_object(
        'account_id', v_user.stripe_connected_account_id,
        'status', v_user.stripe_connect_status,
        'charges_enabled', v_user.stripe_connect_charges_enabled,
        'payouts_enabled', v_user.stripe_connect_payouts_enabled),
      'courses_by_status', coalesce((select jsonb_object_agg(coalesce(g.status, 'unknown'), g.n)
        from (select co.status, count(*) as n from public.courses co
          where co.owner_id = p_uid group by co.status) g), '{}'::jsonb),
      'courses', coalesce((select jsonb_agg(r order by r.updated_at desc nulls last)
        from (select co.id, co.title, co.slug, co.status, co.enrollment_count, co.updated_at
          from public.courses co where co.owner_id = p_uid
          order by co.updated_at desc nulls last limit 20) r), '[]'::jsonb),
      'sales', coalesce((select jsonb_agg(g order by g.status, g.currency)
        from (select o.status, upper(o.currency) as currency, count(*) as n,
            coalesce(sum(o.amount_minor), 0) as amount_minor,
            coalesce(sum(o.refunded_amount_minor), 0) as refunded_minor
          from public.orders o where o.teacher_id = p_uid
          group by o.status, upper(o.currency)) g), '[]'::jsonb)),
    'community', jsonb_build_object(
      'posts', (select count(*) from public.community_posts p where p.author_id = p_uid),
      'comments', (select count(*) from public.community_comments cc where cc.author_id = p_uid),
      'lesson_comments', (select count(*) from public.lesson_comments lc where lc.author_id = p_uid),
      'reports_filed', (select count(*) from public.community_reports cr where cr.reporter_id = p_uid),
      'reports_against_by_status', coalesce((select jsonb_object_agg(coalesce(g.status, 'unknown'), g.n)
        from (select cr.status, count(*) as n from public.community_reports cr
          where cr.target_author_id = p_uid group by cr.status) g), '{}'::jsonb)),
    'support', jsonb_build_object(
      'tickets_by_status', coalesce((select jsonb_object_agg(coalesce(g.status, 'unknown'), g.n)
        from (select t.status, count(*) as n from public.support_tickets t
          where t.user_id = p_uid group by t.status) g), '{}'::jsonb),
      'recent_tickets', coalesce((select jsonb_agg(r order by r.created_at desc nulls last)
        from (select t.id, t.subject, t.status, t.created_at from public.support_tickets t
          where t.user_id = p_uid order by t.created_at desc nulls last limit 5) r), '[]'::jsonb)),
    'privacy_requests', coalesce((select jsonb_agg(r order by r.requested_at desc nulls last)
      from (select q.id, q.type, q.status, q.requested_at, q.resolved_at
        from public.account_action_requests q where q.requested_by = p_uid
        order by q.requested_at desc nulls last limit 10) r), '[]'::jsonb),
    'audit', jsonb_build_object(
      'on_user', coalesce((select jsonb_agg(r order by r.created_at desc nulls last)
        from (select l.id, l.action, l.summary, l.actor_email, l.metadata ->> 'reason' as reason, l.created_at
          from public.audit_log l where l.target_type = 'user' and l.target_id = p_uid
          order by l.created_at desc nulls last limit 20) r), '[]'::jsonb),
      'by_user', coalesce((select jsonb_agg(r order by r.created_at desc nulls last)
        from (select l.id, l.action, l.summary, l.target_type, l.target_id, l.created_at
          from public.audit_log l where l.actor_id = p_uid
          order by l.created_at desc nulls last limit 20) r), '[]'::jsonb)));
end;
$function$;
revoke all on function public.admin_get_user_dossier(text) from public, anon, service_role;
grant execute on function public.admin_get_user_dossier(text) to authenticated;

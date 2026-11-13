-- Ferramentas de IA do professor: legenda, tradução de legenda, quiz e
-- sugestão de título/descrição, todas a partir do vídeo da própria aula.
--
-- Três tabelas e o teto mensal:
--   ai_usage         cada transcrição feita (segundos de vídeo), para o teto do mês.
--   lesson_captions  legenda por aula e idioma, com a data da última publicação. O aluno
--                    não lê daqui: a publicada sobe para a Bunny e aparece no player.
--   lesson_quizzes   quiz por aula. O aluno matriculado lê só o publicado, com a
--                    mesma regra de liberação do texto da aula.
--
-- O teto mensal (horas de vídeo transcritas no mês UTC) vale em todo plano; o
-- que muda é o tamanho. Espelha aiVideoMinutesPerMonth em
-- src/domain/entitlements.ts (o teste lê os números daqui).
--
-- As rotas do servidor escrevem com service_role, depois de conferir sessão e
-- dono do curso. O browser não escreve em nenhuma das três.

-- 1. Teto por plano, em segundos ------------------------------------------------
create or replace function public.ai_video_seconds_limit_for_plan(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_plan_id, 'free')
    when 'starter' then 36000
    when 'pro'     then 108000
    when 'plus'    then 108000
    else 7200          -- free e basic: 2 horas
  end;
$$;

-- 2. Uso -----------------------------------------------------------------------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  owner_id text not null references public.users(uid) on delete cascade,
  course_id text not null,
  lesson_id text not null,
  kind text not null check (kind in ('transcribe')),
  seconds integer not null check (seconds > 0 and seconds <= 7200),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_owner_created_idx on public.ai_usage (owner_id, created_at);

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
revoke all on table public.ai_usage from public, anon, authenticated;
create policy account_access_guard on public.ai_usage as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

-- Plano de quem pede: a concessão (contas da casa) vale antes da assinatura,
-- como em creator_has_current_plan.
create or replace function public.ai_plan_for(p_uid text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select g.plan_id from public.plan_grants g where g.uid = p_uid),
    (select u.current_plan_id from public.users u where u.uid = p_uid),
    'free'
  );
$$;

-- Uso do mês corrente (UTC) e o teto.
create or replace function public.ai_video_usage(p_uid text)
returns table (used_seconds integer, limit_seconds integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(a.seconds)::integer from public.ai_usage a
       where a.owner_id = p_uid
         and a.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    ), 0),
    public.ai_video_seconds_limit_for_plan(public.ai_plan_for(p_uid));
$$;

-- Reserva os segundos de uma transcrição se couberem no teto do mês. Atômica:
-- segura a linha do professor, então dois pedidos ao mesmo tempo não passam os
-- dois pelo mesmo saldo. Sem saldo, usage_id volta null e nada é gravado. Se a
-- transcrição falhar, a rota apaga a linha pelo usage_id (o uso é devolvido).
create or replace function public.claim_ai_video_seconds(
  p_uid text, p_course_id text, p_lesson_id text, p_seconds integer
)
returns table (usage_id bigint, used_seconds integer, limit_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_limit integer;
  v_id bigint;
begin
  if p_seconds is null or p_seconds <= 0 or p_seconds > 7200 then
    raise exception 'AI_INVALID_SECONDS';
  end if;
  perform 1 from public.users u where u.uid = p_uid for update;
  if not found then
    raise exception 'AI_USER_NOT_FOUND';
  end if;

  select u.used_seconds, u.limit_seconds into v_used, v_limit from public.ai_video_usage(p_uid) u;
  if v_used + p_seconds > v_limit then
    return query select null::bigint, v_used, v_limit;
    return;
  end if;

  insert into public.ai_usage (owner_id, course_id, lesson_id, kind, seconds)
  values (p_uid, p_course_id, p_lesson_id, 'transcribe', p_seconds)
  returning id into v_id;
  return query select v_id, v_used + p_seconds, v_limit;
end;
$$;

revoke all on function public.ai_video_seconds_limit_for_plan(text) from public, anon, authenticated;
revoke all on function public.ai_plan_for(text) from public, anon, authenticated;
revoke all on function public.ai_video_usage(text) from public, anon, authenticated;
revoke all on function public.claim_ai_video_seconds(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.ai_video_seconds_limit_for_plan(text) to service_role;
grant execute on function public.ai_plan_for(text) to service_role;
grant execute on function public.ai_video_usage(text) to service_role;
grant execute on function public.claim_ai_video_seconds(text, text, text, integer) to service_role;

-- 3. Legendas ------------------------------------------------------------------
create table if not exists public.lesson_captions (
  lesson_id text not null,
  language text not null check (language ~ '^[a-z]{2}$'),
  course_id text not null references public.courses(id) on delete cascade,
  owner_id text not null references public.users(uid) on delete cascade,
  -- Vídeo da Bunny para o qual a legenda foi feita: trocou o vídeo da aula,
  -- a legenda antiga deixa de valer para o novo.
  video_id text not null,
  vtt text not null check (char_length(vtt) <= 500000),
  updated_at timestamptz not null default now(),
  -- Última vez que o texto subiu para a Bunny. Null = nunca publicada;
  -- updated_at depois dele = há mudança ainda não publicada (a versão da
  -- Bunny continua valendo até o professor publicar de novo).
  published_at timestamptz,
  primary key (lesson_id, language)
);
create index if not exists lesson_captions_course_idx on public.lesson_captions (course_id);

alter table public.lesson_captions enable row level security;
alter table public.lesson_captions force row level security;
revoke all on table public.lesson_captions from public, anon, authenticated;
create policy account_access_guard on public.lesson_captions as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));

-- 4. Quiz ----------------------------------------------------------------------
-- questions: [{ "question": text, "options": [text x 2..5], "answer": índice, "explanation": text }]
-- A forma fina é validada na rota; aqui só o que não pode faltar.
create table if not exists public.lesson_quizzes (
  lesson_id text primary key,
  course_id text not null references public.courses(id) on delete cascade,
  owner_id text not null references public.users(uid) on delete cascade,
  questions jsonb not null check (
    jsonb_typeof(questions) = 'array'
    and jsonb_array_length(questions) between 1 and 10
    and pg_column_size(questions) <= 100000
  ),
  status text not null default 'draft' check (status in ('draft', 'published')),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_quizzes_course_idx on public.lesson_quizzes (course_id);

alter table public.lesson_quizzes enable row level security;
alter table public.lesson_quizzes force row level security;
revoke all on table public.lesson_quizzes from public, anon, authenticated;
grant select on table public.lesson_quizzes to authenticated;
create policy account_access_guard on public.lesson_quizzes as restrictive for all to authenticated
  using ((select public.account_session_allowed()))
  with check ((select public.account_session_allowed()));
-- Mesma regra de course_lesson_content_select (20260915020000), mais: o aluno
-- só vê o quiz publicado. O dono vê o rascunho.
create policy lesson_quizzes_select on public.lesson_quizzes
  as permissive for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = lesson_quizzes.course_id
        and c.owner_id = (select auth.uid())::text
    )
    or (
      lesson_quizzes.status = 'published'
      and exists (
        select 1 from public.enrollments e
        where e.course_id = lesson_quizzes.course_id
          and e.user_id = (select auth.uid())::text
          and e.status = any (array['active'::text, 'completed'::text])
      )
      and public.lesson_is_released(lesson_quizzes.course_id, lesson_quizzes.lesson_id,
        (select auth.uid())::text)
    )
  );

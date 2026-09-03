-- Onde o aluno PARA, e em que SEGUNDO da aula.
--
-- Duas perguntas que hoje nao tem resposta, pelo mesmo motivo: nada e gravado.
--
-- 1. FUNIL. `lesson_progress` so nasce quando a aula e CONCLUIDA
--    (enrollment_id, lesson_id, user_id, completed_at) e
--    `enrollments.last_lesson_id` guarda a ultima aula concluida -- nao "onde a
--    pessoa parou". Quem abre a aula 7 e desiste no meio nao deixa rastro
--    nenhum: para o banco ela nunca esteve la. Sem o par ABRIU/CONCLUIU nao da
--    para responder "em qual aula os alunos param" nem "qual aula tem mais
--    abandono", e nenhuma tela futura consegue reconstruir o passado.
--
-- 2. POSICAO. O segundo em que o video parou vive no `localStorage`
--    (src/lib/learn/lesson-position.ts, PR #186). E por NAVEGADOR: quem comeca
--    no celular e termina no computador recomeca do zero. O proprio modulo ja
--    documentava esta migracao como o caminho de upgrade.
--
-- UMA tabela para as duas, porque sao a mesma linha: "esta matricula, nesta
-- aula". Uma tabela de eventos (uma linha por batida de 10s) responderia mais,
-- mas cresce sem teto e ninguem pediu replay -- o upsert responde as duas
-- perguntas de cima com uma linha por (matricula, aula).
--
-- ESCRITA SO PELA FUNCAO, como `record_lesson_progress` ja faz: nenhuma policy
-- de INSERT/UPDATE existe nesta tabela. O navegador nao escolhe o `user_id` da
-- linha nem grava numa aula de outro curso.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_playback (
  enrollment_id text not null
    references public.enrollments(id) on delete cascade,
  lesson_id text not null,
  user_id text not null,

  -- A PRIMEIRA vez que esta pessoa abriu esta aula. Nunca e reescrito: e a
  -- metade "abriu" do funil, e o que ele mede e a primeira visita.
  opened_at timestamptz not null default now(),

  -- A ultima batida. Alimenta "ultimo acesso" do aluno e "ativos na semana"
  -- sem tabela nova (as duas telas do PR #187 ficaram sem dado por isso).
  last_seen_at timestamptz not null default now(),

  position_seconds integer not null default 0
    check (position_seconds >= 0 and position_seconds <= 86400),
  duration_seconds integer
    check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 86400)),

  primary key (enrollment_id, lesson_id)
);

comment on table public.lesson_playback is
  'Uma linha por (matricula, aula): quando a pessoa ABRIU a aula, quando foi vista pela ultima vez e em que segundo o video parou. Escrita exclusiva de record_lesson_playback().';
comment on column public.lesson_playback.opened_at is
  'Primeira abertura da aula. Com lesson_progress (que so registra conclusao) fecha o par abriu/concluiu do funil.';
comment on column public.lesson_playback.position_seconds is
  'Onde retomar, em segundos. 0 = do comeco (aula terminada, ou perto demais do inicio/fim para valer a pena).';

alter table public.lesson_playback enable row level security;

-- O aluno le a PROPRIA linha e mais nada. `user_id` direto, sem consultar
-- `enrollments`: o predicado fica de um termo so e a guarda de status daquela
-- tabela (20260809080000) nao tem por onde ser esquecida aqui. Historico e
-- dele com matricula viva ou morta, mesma razao de lesson_progress_select_owner.
--
-- O portao do segundo fator entra pela mesma razao de enrollments_select_owner
-- (20260902120000): sem ele, um token aal1 de conta com TOTP leria isto pelo
-- PostgREST direto.
drop policy if exists lesson_playback_select_owner on public.lesson_playback;
create policy lesson_playback_select_owner on public.lesson_playback
  for select
  using (
    user_id = (select auth.uid())::text
    and (select public.session_is_strong())
  );

drop policy if exists lesson_playback_select_admin on public.lesson_playback;
create policy lesson_playback_select_admin on public.lesson_playback
  for select
  using (public.is_admin());

-- Nenhuma policy de INSERT/UPDATE/DELETE. Toda escrita passa por
-- record_lesson_playback(), que confere de quem e a matricula e se a aula
-- pertence ao curso. O professor NUNCA le esta tabela direto -- so o agregado
-- da funcao do fim deste arquivo.
--
-- REVOKE ANTES DO GRANT, e nao por elegancia: o Supabase mantem
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`,
-- entao a tabela NASCE com SELECT/INSERT/UPDATE/DELETE para os dois papeis sem
-- que nada aqui peca por isso. Foi assim que 20260902130000 encontrou uma view
-- aberta no PostgREST. Aqui o RLS ja seguraria (sem policy de escrita, escrita
-- nenhuma passa), mas privilegio que ninguem usa e superficie que ninguem
-- vigia.
revoke all on public.lesson_playback from anon, authenticated;
grant select on public.lesson_playback to authenticated;

-- A assercao E o teste: falha alto se um privilegio voltar por default.
do $$
declare
  sobrando int;
begin
  select count(*) into sobrando
  from (values ('anon'), ('authenticated')) as papel(nome)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
  where has_table_privilege(papel.nome, 'public.lesson_playback', p.priv);

  if sobrando > 0 or has_table_privilege('anon', 'public.lesson_playback', 'SELECT') then
    raise exception
      'lesson_playback com privilegio a mais: toda escrita tem de passar por record_lesson_playback(), e anon nao le nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A escrita
-- ---------------------------------------------------------------------------

-- p_position_seconds NULO tem significado proprio: "so registra que estive
-- aqui", sem tocar a posicao. E o que a abertura da aula manda -- se ela
-- mandasse 0, abrir a aula APAGARIA o ponto de retomada, que e o oposto do
-- que a funcao existe para fazer. Zero explicito continua sendo "zera"
-- (a aula terminou).
create or replace function public.record_lesson_playback(
  p_enrollment_id text,
  p_lesson_id text,
  p_position_seconds integer default null,
  p_duration_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_enrollment_id text;
  v_lesson_id text;
  v_enrollment public.enrollments%rowtype;
  v_course public.courses%rowtype;
  v_duration integer;
  v_position integer;
  v_now timestamptz := now();
  v_row public.lesson_playback%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in before tracking playback.' using errcode = 'P0001';
  end if;

  v_enrollment_id := btrim(coalesce(p_enrollment_id, ''));
  if v_enrollment_id = '' or length(v_enrollment_id) > 220 then
    raise exception 'A valid enrollmentId is required.' using errcode = 'P0001';
  end if;
  v_lesson_id := btrim(coalesce(p_lesson_id, ''));
  if v_lesson_id = '' or length(v_lesson_id) > 200 then
    raise exception 'A valid lessonId is required.' using errcode = 'P0001';
  end if;

  -- O cliente grava a cada ~10s enquanto assiste: 360/hora numa aula corrida,
  -- mais uma batida por aula aberta. 600 deixa folga para quem pula entre
  -- aulas e ainda barra um laco preso mandando por segundo.
  perform public.enforce_rate_limit('lesson_playback_' || v_uid, 600, 3600000);

  select * into v_enrollment
  from public.enrollments
  where id = v_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only track playback for your own enrollments.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status in ('refunded', 'revoked', 'expired') then
    raise exception 'This enrollment is no longer active.' using errcode = 'P0001';
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;

  -- Mesma pergunta que record_lesson_progress faz, no formato mais barato:
  -- basta saber se a aula existe no curso, nao montar a lista inteira.
  if not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(v_course.modules) = 'array'
        then v_course.modules
        else '[]'::jsonb
      end
    ) as m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m->'lessons') = 'array'
        then m->'lessons'
        else '[]'::jsonb
      end
    ) as lesson
    where lesson->>'id' = v_lesson_id
  ) then
    raise exception 'That lesson does not belong to this course.'
      using errcode = 'P0001';
  end if;

  v_duration := case
    when p_duration_seconds is not null
      and p_duration_seconds > 0
      and p_duration_seconds <= 86400
    then p_duration_seconds
    else null
  end;

  -- Posicao fora da fita e descartada (o professor regravou a aula mais curta,
  -- ou o player reportou lixo): a visita continua sendo registrada, a posicao
  -- guardada e que nao se mexe. Nulo = a chamada nem falava de posicao.
  v_position := case
    when p_position_seconds is null then null
    when p_position_seconds < 0 or p_position_seconds > 86400 then null
    when v_duration is not null and p_position_seconds > v_duration then null
    else p_position_seconds
  end;

  insert into public.lesson_playback as lp (
    enrollment_id, lesson_id, user_id,
    opened_at, last_seen_at, position_seconds, duration_seconds
  )
  values (
    v_enrollment_id, v_lesson_id, v_uid,
    v_now, v_now, coalesce(v_position, 0), v_duration
  )
  on conflict (enrollment_id, lesson_id) do update set
    last_seen_at = v_now,
    -- opened_at NAO entra: a primeira abertura e a que o funil mede.
    position_seconds = coalesce(v_position, lp.position_seconds),
    duration_seconds = coalesce(v_duration, lp.duration_seconds)
  returning * into v_row;

  return jsonb_build_object(
    'positionSeconds', v_row.position_seconds,
    'openedAt', to_jsonb(v_row.opened_at),
    'lastSeenAt', to_jsonb(v_row.last_seen_at)
  );
end;
$function$;

comment on function public.record_lesson_playback(text, text, integer, integer) is
  'Registra a visita a uma aula e onde o video parou. p_position_seconds nulo = so a visita (nao apaga a posicao); 0 = zera. Uma linha por (matricula, aula).';

revoke execute on function public.record_lesson_playback(text, text, integer, integer)
  from public, anon;
grant execute on function public.record_lesson_playback(text, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O que o professor pode ver: AGREGADO, nunca a linha do aluno
-- ---------------------------------------------------------------------------

-- Sem argumento, como get_my_course_students(): sem parametro nao existe
-- superficie de enumeracao -- o professor so pergunta "como esta o funil dos
-- MEUS cursos", nunca "onde o aluno X parou". A projecao nao tem user_id nem
-- enrollment_id, so contagens: a linha crua de um aluno nao sai daqui.
create or replace function public.get_my_course_lesson_funnel()
returns table (
  course_id text,
  lesson_id text,
  students_opened integer,
  students_completed integer,
  last_activity_at timestamptz
)
language sql
stable
security definer
-- pg_temp por ULTIMO de proposito (mesmo pin de 20260811010000): fora da lista
-- o schema temporario e procurado ANTES de todos, e qualquer usuario poderia
-- criar uma tabela temporaria para sequestrar uma funcao SECURITY DEFINER.
set search_path = public, pg_temp
as $$
  select
    e.course_id,
    p.lesson_id,
    count(*)::integer as students_opened,
    count(*) filter (where lp.lesson_id is not null)::integer as students_completed,
    max(p.last_seen_at) as last_activity_at
  from public.lesson_playback p
  join public.enrollments e on e.id = p.enrollment_id
  join public.courses c on c.id = e.course_id
  left join public.lesson_progress lp
    on lp.enrollment_id = p.enrollment_id
   and lp.lesson_id = p.lesson_id
  where c.owner_id = (select auth.uid())::text
  group by e.course_id, p.lesson_id;
$$;

comment on function public.get_my_course_lesson_funnel() is
  'Funil por aula dos cursos do proprio chamador: quantos ABRIRAM, quantos CONCLUIRAM. Agregado -- nao devolve aluno nem matricula.';

-- ponytail: sem paginacao e sem filtro por curso, como get_my_course_students.
-- E uma leitura indexada por owner_id agrupando as aulas do professor.
-- Adicionar p_course_id + LIMIT quando alguem tiver catalogo grande o bastante
-- para sentir.

revoke execute on function public.get_my_course_lesson_funnel() from public, anon;
grant execute on function public.get_my_course_lesson_funnel() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Ultimo acesso" e "ativos na semana", de graca
-- ---------------------------------------------------------------------------

-- As duas telas do PR #187 ficaram sem dado porque a plataforma nao sabia
-- quando o aluno apareceu pela ultima vez -- `enrollments.updated_at` so se
-- move quando ele CONCLUI uma aula. Agora sabe: uma coluna a mais na lista que
-- o professor ja le, sem tabela nova nem RPC nova. O tipo de retorno muda,
-- entao a funcao e derrubada antes (create or replace nao troca assinatura).
drop function if exists public.get_my_course_students();

create or replace function public.get_my_course_students()
returns table (
  enrollment_id text,
  course_id text,
  course_title text,
  uid text,
  display_name text,
  email text,
  photo_url text,
  status text,
  source text,
  progress_percent integer,
  enrolled_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.course_id,
    e.course_title,
    u.uid,
    u.display_name,
    u.email,
    u.photo_url,
    e.status,
    e.source,
    e.progress_percent,
    e.created_at,
    (
      select max(p.last_seen_at)
      from public.lesson_playback p
      where p.enrollment_id = e.id
    )
  from public.enrollments e
  join public.courses c on c.id = e.course_id
  left join public.users u on u.uid = e.user_id
  where c.owner_id = (select auth.uid())::text
  order by e.created_at desc;
$$;

comment on function public.get_my_course_students() is
  'Lista os alunos matriculados nos cursos do proprio chamador (nome, e-mail, status, progresso, ultimo acesso). Sem argumento: nao da para consultar usuario arbitrario.';

revoke execute on function public.get_my_course_students() from public, anon;
grant execute on function public.get_my_course_students() to authenticated;

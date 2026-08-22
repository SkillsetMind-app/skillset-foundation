-- Pagina de venda do curso: blocos que o professor organiza, em um de dois
-- modelos.
--
-- Estava no backlog como P2 desde 2026-07-14 ("Pagina de venda por curso --
-- block editor com templates ... Templates prontos + blocos editaveis"), com a
-- decisao irma de NAO construir site builder multi-pagina freeform. Esta
-- migracao entrega exatamente o recorte aprovado, nada alem.
--
-- TABELA SEPARADA, NAO COLUNA EM `courses`. Duas razoes medidas, nao supostas:
--
-- 1. `subscribeToPublishedTeacherCourses` faz `select('*')` com LIMIT 200 a
--    cada visita ao marketplace (src/lib/data/published-courses.ts). Uma coluna
--    gorda ali multiplicaria o payload por 200 para TODO visitante, inclusive
--    quem nunca abre uma pagina de venda.
--
-- 2. `update_teacher_course_builder` e FULL-REPLACE: campo ausente no payload e
--    sobrescrito pelo default computado. Tem tres chamadores, um deles com
--    AUTOSAVE. Blocos morando naquele payload seriam apagados em silencio na
--    primeira vez que qualquer chamador esquecesse de reenvia-los.
--
-- Uma linha separada por curso custa uma leitura a mais na pagina que
-- realmente precisa dela, e elimina os dois problemas.
--
-- SEM HTML. Nao existe sanitizador de HTML neste repositorio (sem DOMPurify) e
-- `toPlainProse` e um normalizador de markdown para os paineis de IA, nao uma
-- fronteira de seguranca. Por isso os blocos sao DADO ESTRUTURADO, renderizado
-- como React. `dangerouslySetInnerHTML` nao pode aparecer no renderer.
--
-- COTA no banco, como sempre: o numero em src/domain/entitlements.ts serve a
-- UI, esta funcao e quem aplica. Teste de deriva em entitlements.test.tsx.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

create table if not exists public.course_landings (
  course_id text primary key references public.courses(id) on delete cascade,

  template text not null default 'classic'
    check (template in ('classic', 'bold')),

  blocks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blocks) = 'array'),

  updated_at timestamptz not null default now()
);

comment on table public.course_landings is
  'Pagina de venda do curso: blocos estruturados + modelo. Tabela separada de courses de proposito -- ver o cabecalho da migracao 20260820010000.';

alter table public.course_landings enable row level security;

-- Leitura publica espelhando EXATAMENTE a regra de courses_select_public
-- (rls_baseline_snapshot.sql): visivel para o mundo quando o curso esta
-- 'published' ou 'in_review'. Espelhar em vez de inventar impede o caso em que
-- a pagina de venda vaza antes do curso a que ela pertence.
drop policy if exists course_landings_select_public on public.course_landings;
create policy course_landings_select_public on public.course_landings
  for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.status in ('published', 'in_review')
    )
  );

-- O dono le a propria sempre, inclusive em rascunho -- senao o editor abriria
-- vazio para um curso que ainda nao foi publicado, que e justamente quando o
-- professor esta montando a pagina.
drop policy if exists course_landings_select_owner on public.course_landings;
create policy course_landings_select_owner on public.course_landings
  for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.owner_id = (select auth.uid())::text
    )
  );

-- Nenhuma policy de INSERT/UPDATE: toda escrita passa pela funcao abaixo, que e
-- onde a cota e conferida. Uma policy de update aqui seria um caminho para o
-- navegador gravar mais blocos do que o plano permite.

grant select on public.course_landings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cota -- espelha planEntitlements[*].quotas.landingBlocks (D25)
-- ---------------------------------------------------------------------------

create or replace function public.landing_block_limit_for_plan(p_plan_id text)
returns integer
language sql
immutable
as $$
  select case coalesce(p_plan_id, 'free')
    when 'starter' then 8
    when 'pro'     then 20
    when 'plus'    then 20
    else 4            -- free
  end;
$$;

comment on function public.landing_block_limit_for_plan(text) is
  'Espelha planEntitlements[*].quotas.landingBlocks em src/domain/entitlements.ts. Divergiu => o teste de deriva em entitlements.test.tsx falha.';

-- Escolher modelo e recurso pago, exatamente como a vitrine do professor. Free
-- fica com `classic`, que e uma pagina completa -- nao uma versao capada.
-- Reusa o mesmo gate de plano que public_storefront_projection() ja aplica, em
-- vez de inventar um segundo que poderia divergir dele.
create or replace function public.landing_template_allowed(
  p_plan_id text,
  p_template text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_template = 'classic' then true
    else coalesce(p_plan_id, 'free') <> 'free'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Salvar
-- ---------------------------------------------------------------------------

create or replace function public.save_own_course_landing(
  p_course_id text,
  p_template text,
  p_blocks jsonb
)
returns void
language plpgsql
security definer
-- pg_temp por ULTIMO: sem isso o Postgres procura o schema temporario primeiro
-- e qualquer usuario poderia criar uma tabela temporaria chamada
-- `course_landings` para sequestrar esta funcao.
set search_path = public, pg_temp
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_plan text;
  v_limit integer;
  v_count integer;
  v_template text := coalesce(p_template, 'classic');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Dono, e so o dono. Sem contar se o curso existe: um professor perguntando
  -- por um id que nao e dele recebe a mesma resposta nos dois casos.
  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.owner_id = v_uid
  ) then
    raise exception 'not your course' using errcode = '42501';
  end if;

  if jsonb_typeof(p_blocks) is distinct from 'array' then
    raise exception 'blocks must be an array' using errcode = 'P0001';
  end if;

  select u.current_plan_id into v_plan
    from public.users u where u.uid = v_uid;

  if not public.landing_template_allowed(v_plan, v_template) then
    raise exception 'template not included on this plan' using errcode = 'P0001';
  end if;

  v_limit := public.landing_block_limit_for_plan(v_plan);
  v_count := jsonb_array_length(p_blocks);

  if v_count > v_limit then
    raise exception 'block quota reached: % of %', v_count, v_limit
      using errcode = 'P0001';
  end if;

  -- Teto absoluto de tamanho, independente de plano. Espelha
  -- LANDING_LIMITS.maxSerializedBytes no TypeScript. A linha e legivel pelo
  -- mundo assim que o curso e publicado, entao este e o limite entre o
  -- professor e usar o nosso banco como armazenamento gratuito.
  if octet_length(p_blocks::text) > 16000 then
    raise exception 'landing page too large' using errcode = 'P0001';
  end if;

  insert into public.course_landings (course_id, template, blocks, updated_at)
  values (p_course_id, v_template, p_blocks, now())
  on conflict (course_id) do update
    set template   = excluded.template,
        blocks     = excluded.blocks,
        updated_at = now();
end;
$$;

revoke execute on function public.save_own_course_landing(text, text, jsonb)
  from public, anon;
grant execute on function public.save_own_course_landing(text, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verificacao
-- ---------------------------------------------------------------------------

do $$
begin
  assert public.landing_block_limit_for_plan('free') = 4,
    'free deve ter 4 blocos (D25)';
  assert public.landing_block_limit_for_plan('starter') = 8,
    'starter deve ter 8 blocos (D25)';
  assert public.landing_block_limit_for_plan('pro') = 20,
    'pro deve ter 20 blocos (D25)';

  -- Free tem uma pagina completa no modelo classico; o que ele nao tem e a
  -- ESCOLHA de modelo.
  assert public.landing_template_allowed('free', 'classic'),
    'free precisa poder usar o modelo classico';
  assert not public.landing_template_allowed('free', 'bold'),
    'escolher modelo e recurso pago';
  assert public.landing_template_allowed('starter', 'bold'),
    'starter paga e portanto escolhe modelo';

  raise notice 'course landing pages aplicado';
end $$;

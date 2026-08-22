-- Sub-plano 7: o professor aponta o proprio dominio para a vitrine dele.
--
-- Estado antes desta migracao: `customDomains` existia como numero em
-- src/domain/entitlements.ts (0/0/1/3) e NADA no sistema lia esse numero. Sem
-- tabela, sem tela, sem verificacao. A auditoria competitiva de 2026-08-20
-- registrou que os quatro concorrentes entregam dominio proprio no plano mais
-- barato, e que o bloqueio aqui era uma pergunta ("quanto a Vercel cobra por
-- dominio?") cuja resposta e: no plano Pro, nada. Dominios ilimitados, SSL
-- automatico. Ver D25.
--
-- DUAS TABELAS, e a separacao e o ponto principal desta migracao:
--
--   `custom_domains`  -- privada. Guarda o pedido, o desafio TXT, o erro. So o
--                        dono le a propria linha.
--   `public_domains`  -- publica, legivel por `anon`. So hostname -> uid, e SO
--                        de dominio ja verificado.
--
-- Por que duas: o proxy (src/proxy.ts) resolve o host em TODA requisicao, e
-- roda com a chave `anon`. Ele precisa de uma leitura publica e minima. Dar a
-- ele a tabela privada significaria ou expor status e desafios de verificacao
-- ao mundo, ou colocar a chave service_role na borda -- as duas inaceitaveis.
-- Mesmo desenho que `public_profiles` ja usa para o perfil.
--
-- A TRAVA QUE MAIS IMPORTA: so `active` entra em `public_domains`. O DNS de um
-- dominio pode apontar para nos ANTES de a posse estar provada. Servir nessa
-- janela seria estacionar o nome de outra pessoa sobre o nosso certificado, que
-- e exatamente o ataque que a verificacao existe para impedir. Espelhado em
-- `resolvableHostnames()` no TypeScript, com teste.
--
-- COTA: conferida aqui, nao no TypeScript. Regra do repositorio -- o numero em
-- entitlements.ts serve a UI, o banco e quem aplica. Ha teste de deriva em
-- src/domain/entitlements.test.tsx que falha se os dois divergirem.

-- ---------------------------------------------------------------------------
-- 1. Tabela privada
-- ---------------------------------------------------------------------------

create table if not exists public.custom_domains (
  id text primary key default gen_random_uuid()::text,
  owner_uid text not null references public.users(uid) on delete cascade,

  -- Guardado ja normalizado (minusculo, sem esquema, sem ponto final). O check
  -- e a ultima linha de defesa, nao a primeira: parseCustomDomain() em
  -- src/domain/custom-domain.ts recusa homoglifo, dominio reservado e IP
  -- disfarcado muito antes de chegar aqui. O check pega o caso da linha escrita
  -- fora do app.
  hostname text not null unique
    check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),

  status text not null default 'pending_dns'
    check (status in ('pending_dns', 'pending_verification', 'active', 'error')),

  -- Desafio TXT que a Vercel pediu, quando pediu.
  verification_name text,
  verification_value text,
  -- Texto ja tratado para leitura humana; nunca a mensagem crua do SDK, que
  -- cita project id e team slug.
  error_reason text,

  created_at timestamptz not null default now(),
  verified_at timestamptz
);

comment on table public.custom_domains is
  'Dominios proprios dos professores. Privada: so o dono le. A projecao publica para o roteamento por host mora em public_domains.';

create index if not exists custom_domains_owner_idx
  on public.custom_domains (owner_uid);

alter table public.custom_domains enable row level security;

-- Leitura: so a propria linha. Escrita: NINGUEM direto -- toda mutacao passa
-- pelas funcoes SECURITY DEFINER abaixo, que sao onde a cota e conferida. Uma
-- policy de insert aqui seria um caminho para furar a cota pelo navegador.
drop policy if exists custom_domains_select_owner on public.custom_domains;
create policy custom_domains_select_owner on public.custom_domains
  for select
  using (owner_uid = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 2. Projecao publica -- o que o proxy le
-- ---------------------------------------------------------------------------

create table if not exists public.public_domains (
  hostname text primary key,
  uid text not null,
  updated_at timestamptz not null default now()
);

comment on table public.public_domains is
  'hostname -> uid, apenas de dominios verificados. Lida por anon no proxy a cada requisicao. Escrita exclusivamente pelo trigger sync_public_domain().';

alter table public.public_domains enable row level security;

-- Legivel pelo mundo de proposito: e o mapa que o proxy consulta antes de
-- existir qualquer sessao. Nao carrega nada sensivel -- um hostname que ja
-- resolve publicamente, e um uid que ja aparece na URL /instructors/<uid>.
drop policy if exists public_domains_select_all on public.public_domains;
create policy public_domains_select_all on public.public_domains
  for select
  using (true);

grant select on public.public_domains to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trigger de projecao
-- ---------------------------------------------------------------------------

create or replace function public.sync_public_domain()
returns trigger
language plpgsql
security definer
-- pg_temp por ULTIMO: sem isso o Postgres procura o schema temporario primeiro
-- e qualquer usuario poderia criar uma tabela temporaria chamada
-- `public_domains` para sequestrar esta funcao. Mesmo pin da 20260811010000.
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.public_domains where hostname = old.hostname;
    return old;
  end if;

  if (new.status = 'active') then
    insert into public.public_domains (hostname, uid, updated_at)
    values (new.hostname, new.owner_uid, now())
    on conflict (hostname) do update
      set uid = excluded.uid,
          updated_at = now();
  else
    -- Saiu de active (verificacao revogada, erro, plano rebaixado) => para de
    -- resolver na proxima escrita, sem job de limpeza. Mesma convencao que
    -- sync_public_profile() usa para professor que perde o papel.
    delete from public.public_domains where hostname = new.hostname;
  end if;

  return new;
end;
$$;

-- A lista do `after update of` e o gatilho real: sem `status` aqui, verificar um
-- dominio nao dispararia nada e ele nunca comecaria a resolver.
drop trigger if exists custom_domains_sync_public_aiud on public.custom_domains;
create trigger custom_domains_sync_public_aiud
after insert or delete or update of status, hostname, owner_uid
on public.custom_domains
for each row execute function public.sync_public_domain();

-- ---------------------------------------------------------------------------
-- 4. Cota -- espelha planEntitlements[*].quotas.customDomains (D25)
-- ---------------------------------------------------------------------------

create or replace function public.custom_domain_limit_for_plan(p_plan_id text)
returns integer
language sql
immutable
as $$
  select case coalesce(p_plan_id, 'free')
    when 'starter' then 1
    when 'pro'     then 3
    when 'plus'    then 5
    else 0            -- free: nao incluso
  end;
$$;

comment on function public.custom_domain_limit_for_plan(text) is
  'Espelha planEntitlements[*].quotas.customDomains em src/domain/entitlements.ts. Divergiu => o teste de deriva em entitlements.test.tsx falha.';

-- Sem argumento de proposito: o professor so pergunta pela PROPRIA cota, nunca
-- pela de outro. Mesma doutrina anti-enumeracao da 20260811010000.
create or replace function public.get_my_custom_domain_quota()
returns table (used integer, "limit" integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*)::integer
       from public.custom_domains d
      where d.owner_uid = (select auth.uid())::text),
    public.custom_domain_limit_for_plan(
      (select u.current_plan_id from public.users u
        where u.uid = (select auth.uid())::text)
    );
$$;

revoke execute on function public.get_my_custom_domain_quota() from public, anon;
grant execute on function public.get_my_custom_domain_quota() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reivindicar um dominio -- o unico caminho de escrita
-- ---------------------------------------------------------------------------

create or replace function public.claim_custom_domain(p_hostname text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_plan text;
  v_used integer;
  v_limit integer;
  v_id text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select current_plan_id into v_plan from public.users where uid = v_uid;
  v_limit := public.custom_domain_limit_for_plan(v_plan);

  if v_limit = 0 then
    raise exception 'custom domains are not included on this plan'
      using errcode = 'P0001';
  end if;

  select count(*) into v_used from public.custom_domains where owner_uid = v_uid;

  if v_used >= v_limit then
    raise exception 'domain quota reached: % of %', v_used, v_limit
      using errcode = 'P0001';
  end if;

  -- Sempre nasce pending_dns. Nunca active: a Vercel e quem decide se um
  -- dominio esta verificado, e ate ela dizer que sim este dominio nao pode
  -- aparecer em public_domains.
  insert into public.custom_domains (owner_uid, hostname, status)
  values (v_uid, lower(trim(p_hostname)), 'pending_dns')
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_custom_domain(text) from public, anon;
grant execute on function public.claim_custom_domain(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Gravar o que a Vercel respondeu
-- ---------------------------------------------------------------------------

create or replace function public.sync_own_custom_domain(
  p_id text,
  p_status text,
  p_verification_name text default null,
  p_verification_value text default null,
  p_error_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := (select auth.uid())::text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status not in ('pending_dns', 'pending_verification', 'active', 'error') then
    raise exception 'unknown status: %', p_status using errcode = 'P0001';
  end if;

  -- O `where owner_uid` e o que impede um professor de sincronizar o dominio de
  -- outro passando um id que nao e dele. Silencioso quando nao casa: nao contar
  -- se o id existe e recusa de enumeracao, nao descuido.
  update public.custom_domains
     set status             = p_status,
         verification_name  = p_verification_name,
         verification_value = p_verification_value,
         error_reason       = p_error_reason,
         verified_at        = case
                                when p_status = 'active' then coalesce(verified_at, now())
                                else null
                              end
   where id = p_id
     and owner_uid = v_uid;
end;
$$;

revoke execute on function public.sync_own_custom_domain(text, text, text, text, text)
  from public, anon;
grant execute on function public.sync_own_custom_domain(text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Remover
-- ---------------------------------------------------------------------------

create or replace function public.release_own_custom_domain(p_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_hostname text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from public.custom_domains
   where id = p_id and owner_uid = v_uid
   returning hostname into v_hostname;

  -- Devolve o hostname para a rota poder desanexar na Vercel. Null significa
  -- que nao era dele, e a rota nao deve chamar a Vercel.
  return v_hostname;
end;
$$;

revoke execute on function public.release_own_custom_domain(text) from public, anon;
grant execute on function public.release_own_custom_domain(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Verificacao
-- ---------------------------------------------------------------------------

do $$
declare
  vazando integer;
begin
  -- Nenhum dominio nao-verificado pode estar resolvendo.
  select count(*) into vazando
  from public.public_domains pd
  join public.custom_domains cd on cd.hostname = pd.hostname
  where cd.status <> 'active';

  assert vazando = 0,
    format('trava furada: %s dominio(s) nao verificado(s) em public_domains', vazando);

  -- A cota do free tem que ser zero, senao a projecao publica passaria a servir
  -- vitrine de plano gratuito por dominio proprio.
  assert public.custom_domain_limit_for_plan('free') = 0,
    'free nao pode ter cota de dominio proprio';

  assert public.custom_domain_limit_for_plan('starter') = 1,
    'starter deve ter 1 dominio (D25)';

  raise notice 'custom domains aplicado';
end $$;

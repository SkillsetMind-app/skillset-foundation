-- Duas requisições ao mesmo tempo davam ao professor mais domínios do que o
-- plano dele inclui.
--
-- `claim_custom_domain` fazia, nesta ordem: lê o plano do dono, conta os
-- domínios dele, compara com a cota, insere. Entre a contagem e o insert não
-- havia lock de linha, advisory lock nem constraint — o único UNIQUE da tabela
-- é em `hostname`, que não limita nada por dono. Em READ COMMITTED (padrão do
-- Supabase) duas transações simultâneas leem o mesmo count, as duas passam
-- pela cota e as duas inserem. Um professor em starter (cota 1) disparando N
-- POSTs paralelos ficava com N domínios pelo preço de 1 — cada um anexado ao
-- projeto Vercel da plataforma e gastando a cota de 100 adições/hora que é
-- compartilhada pelo time inteiro. `get_my_custom_domain_quota` passava a
-- responder `used > limit`, estado que a UI não prevê.
--
-- A rota (src/app/api/teach/domains/route.ts) diz, no próprio comentário, que
-- delegou a cota ao SQL exatamente para não ter esta corrida. A corrida foi
-- movida para cá sem ser resolvida.
--
-- O conserto é o padrão que o repositório já usa para o teto de resgates de
-- cupom (20260810012715: `for update` na linha do curso): o SELECT que lê o
-- plano passa a travar a linha do dono em `users`. A segunda transação espera
-- a primeira commitar e só então conta — e vê o domínio recém-inserido. Cada
-- dono serializa consigo mesmo; professores diferentes não se bloqueiam. Se a
-- linha em `users` não existe, nada é travado, mas o plano nulo dá cota zero
-- e a função recusa antes de qualquer insert.
--
-- A função tem 40 linhas e é redefinida por inteiro em vez de receber um
-- patch textual: assim a última migration continua sendo a definição legível,
-- e o guarda em src/lib/supabase/rpc-definition-guards.test.ts lê o corpo
-- daqui. O bloco abaixo ABORTA se a definição viva não for a que esta
-- migration espera substituir — um hotfix desconhecido em produção não pode
-- ser sobrescrito em silêncio.

DO $preflight$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'claim_custom_domain';

  IF v_def IS NULL THEN
    RAISE EXCEPTION
      'claim_custom_domain nao existe: a 20260820000000_custom_domains precisa ter rodado antes.';
  END IF;

  -- A leitura sem lock que esta migration substitui. O regex tolera espaço e
  -- quebra de linha (os corpos gravados usam CRLF).
  IF v_def !~* 'select\s+current_plan_id\s+into\s+v_plan\s+from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s*;' THEN
    RAISE EXCEPTION
      'claim_custom_domain ja nao tem a leitura sem lock que esta migration substitui. Abortando em vez de sobrescrever uma definicao desconhecida.';
  END IF;
END;
$preflight$;

create or replace function public.claim_custom_domain(p_hostname text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- O lock na linha do dono é o que torna a cota atômica: fica preso até o
  -- commit. Duas reivindicações simultâneas do mesmo professor deixam de ver o
  -- mesmo count — a segunda espera a primeira terminar e conta o que ela
  -- inseriu. Sem ele, N POSTs paralelos davam N domínios pelo preço de 1.
  select current_plan_id into v_plan
    from public.users
   where uid = v_uid
     for update;
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
$function$;

-- `create or replace` preserva a ACL, mas os grants ficam restatados para a
-- migration ser legível sozinha: só o usuário logado reivindica, nunca anon.
revoke all on function public.claim_custom_domain(text) from public;
revoke execute on function public.claim_custom_domain(text) from anon;
grant execute on function public.claim_custom_domain(text) to authenticated;

comment on function public.claim_custom_domain(text) is
  'Reivindica um dominio para o professor logado. A cota do plano e conferida '
  'aqui, com a linha do dono em users travada (for update) antes da contagem, '
  'para que duas chamadas simultaneas nao furem o limite.';

-- Prova, na própria migration: a definição viva trava o dono ANTES de contar,
-- e a função continua fora do alcance de anon.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'claim_custom_domain';

  -- `.` casa quebra de linha no modo padrão do Postgres, então o regex exige a
  -- ORDEM: primeiro o lock na linha do dono, depois a contagem.
  IF v_def !~* 'from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s+for\s+update.*count\(\*\)' THEN
    RAISE EXCEPTION
      'claim_custom_domain continua contando dominios sem travar a linha do dono.';
  END IF;

  IF has_function_privilege('anon', 'public.claim_custom_domain(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'claim_custom_domain nao pode ser executavel por anon.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.claim_custom_domain(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated precisa executar claim_custom_domain.';
  END IF;
END;
$verify$;

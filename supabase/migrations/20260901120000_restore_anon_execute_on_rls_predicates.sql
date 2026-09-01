-- O catálogo público está quebrado: um visitante deslogado não lê NADA de
-- public.courses. Medido em produção, duas vezes, antes de escrever esta linha:
--
--     set local role anon;
--     select count(*) from public.courses;
--     -- ERROR 42501: permission denied for function has_enrollment_for_course_slug
--
-- Não é "retorna vazio". É a query inteira abortando. Homepage, catálogo,
-- página de curso e vitrine de professor dependem dessa leitura, então o funil
-- de aquisição inteiro está morto para quem ainda não tem conta — exatamente o
-- público que precisa ver a loja para virar cliente.
--
-- CAUSA
--
-- 20260819180000_revoke_anon_role_predicates.sql revogou o EXECUTE de anon nos
-- predicados de papel, com esta justificativa no próprio arquivo:
--
--     "RLS policies that call these run as part of policy evaluation,
--      not through the REST grant, so they are unaffected."
--
-- Essa premissa é falsa. O Postgres avalia a expressão de uma policy com os
-- privilégios do papel corrente, não com os do dono da tabela. Se a expressão
-- chama uma função que o papel não pode executar, a consulta aborta com 42501
-- em vez de simplesmente filtrar linhas. Toda policy deste banco está declarada
-- como `TO public`, ou seja, é avaliada também para anon — inclusive as que
-- existem só para dar acesso a admin.
--
-- has_enrollment_for_course_slug nunca chegou a ter grant para anon em migration
-- alguma, então a leitura anônima de courses provavelmente já nascia quebrada;
-- a revogação de 19/08 estendeu o mesmo defeito a is_admin, is_teacher, is_ops,
-- is_support, is_moderator e is_target_author, e com isso a mais 25 tabelas cujas
-- policies de SELECT chamam esses predicados.
--
-- POR QUE CONCEDER É SEGURO
--
-- As sete funções são STABLE, SECURITY DEFINER com search_path fixado, e todas
-- resolvem a identidade por (select auth.uid()). Para anon, auth.uid() é nulo,
-- logo todas retornam false. Conceder EXECUTE não concede poder nenhum: apenas
-- deixa a policy ser AVALIADA em vez de estourar. Provado em transação revertida,
-- contra produção:
--
--     ANTES   anon select courses    -> ERRO 42501
--     DEPOIS  anon select courses    -> OK
--     DEPOIS  anon is_admin()        -> false
--     DEPOIS  anon is_teacher()      -> false
--     DEPOIS  anon is_ops()          -> false
--     DEPOIS  anon vê rascunhos      -> 0   (a policy segue filtrando)
--
-- O linter do banco vai voltar a sinalizar estas funções como
-- anon-executable. É um falso positivo aqui: o alerta existe para funções que
-- EXPÕEM algo a quem não tem sessão, e um predicado que responde false sem
-- sessão não expõe nada. Preferir o alerta do linter à loja fechada.
--
-- LIÇÃO, para não repetir: antes de revogar EXECUTE de qualquer função citada
-- em policy, rodar `set local role anon; select ... from <tabela>;` numa
-- transação. O linter não sabe quais funções as policies chamam.

grant execute on function public.is_admin() to anon;
grant execute on function public.is_moderator() to anon;
grant execute on function public.is_ops() to anon;
grant execute on function public.is_support() to anon;
grant execute on function public.is_teacher() to anon;
grant execute on function public.is_target_author(text, text) to anon;
grant execute on function public.has_enrollment_for_course_slug(text) to anon;

-- Trava de regressão: falha a migration se qualquer predicado citado em policy
-- continuar inexecutável por anon. Pega tanto um erro aqui quanto uma revogação
-- futura feita pela mesma boa intenção de 19/08.
DO $$
DECLARE faltando text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ')
    INTO faltando
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND EXISTS (
       SELECT 1 FROM pg_policies pol
        WHERE pol.schemaname = 'public'
          AND (pol.roles::text LIKE '%anon%' OR pol.roles::text = '{public}')
          AND (coalesce(pol.qual,'') || ' ' || coalesce(pol.with_check,''))
              LIKE '%' || p.proname || '(%'
     );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'Predicados citados em policy que anon nao pode executar: %. Leitura anonima dessas tabelas vai abortar com 42501.',
      faltando;
  END IF;
END $$;

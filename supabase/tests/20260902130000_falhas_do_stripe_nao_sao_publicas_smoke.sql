\set ON_ERROR_STOP on

-- Seguro contra banco vivo: nada é escrito. As trocas de papel são `set local`
-- e morrem no ROLLBACK junto com a transação.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition boolean,
  p_message text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', p_message;
  END IF;
END;
$$;

-- (1) A propriedade estrutural: a view consulta o RLS da tabela-base em vez de
-- atravessá-lo com os privilégios do dono. Sem isto, um grant acidental volta a
-- expor a tabela inteira em vez de zero linhas.
SELECT pg_temp.assert_true(
  COALESCE((
    SELECT option_value
    FROM pg_options_to_table(c.reloptions)
    WHERE option_name = 'security_invoker'
  ), 'false') = 'true',
  'stripe_events_needing_attention must run as security_invoker'
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'stripe_events_needing_attention';

-- (2) A propriedade de privilégio: nenhum dos quatro verbos sobra para os dois
-- papéis que o PostgREST expõe sem credencial de servidor.
SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    papel.nome, 'public.stripe_events_needing_attention', p.priv
  ),
  format('%s must not hold %s on stripe_events_needing_attention', papel.nome, p.priv)
)
FROM (VALUES ('anon'), ('authenticated')) AS papel(nome)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);

-- (3) A prova de comportamento, e não só de catálogo: como anon, a view precisa
-- recusar a leitura. `permission denied` (42501) é o resultado esperado;
-- qualquer linha devolvida aqui é a regressão que esta migration fecha.
DO $$
DECLARE
  linhas int;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO linhas FROM public.stripe_events_needing_attention;
    RESET ROLE;
    RAISE EXCEPTION
      'SMOKE_ASSERTION_FAILED: anon read stripe_events_needing_attention (% rows)', linhas;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END;
$$;

-- (4) O caminho legítimo continua de pé: o service role enxerga a view. A
-- contagem não importa (zero é o estado saudável); o que se afirma é que a
-- consulta roda sem erro de privilégio.
DO $$
DECLARE
  linhas int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO linhas FROM public.stripe_events_needing_attention;
  RESET ROLE;
  PERFORM pg_temp.assert_true(
    linhas >= 0, 'service_role must still be able to read the view'
  );
END;
$$;

ROLLBACK;

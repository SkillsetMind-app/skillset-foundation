\set ON_ERROR_STOP on

-- Nada e gravado: so catalogo e chamadas de funcoes IMMUTABLE. O BEGIN/ROLLBACK
-- segue o padrao dos outros smoke tests.
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

-- ---------------------------------------------------------------------------
-- 1. O que o advisor do Supabase confere: search_path fixo no proconfig.
--    `set search_path = ''` fica gravado como search_path="". O cast para
--    regprocedure tambem falha se alguma assinatura sumir.
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_true(
  'search_path=""' = ANY (coalesce(p.proconfig, '{}')),
  format('%s sem search_path fixo (proconfig=%s)', p.oid::regprocedure, p.proconfig)
)
FROM pg_proc p
WHERE p.oid IN (
  'public.custom_domain_limit_for_plan(text)'::regprocedure,
  'public.landing_block_limit_for_plan(text)'::regprocedure,
  'public.landing_template_allowed(text,text)'::regprocedure
);

-- ---------------------------------------------------------------------------
-- 2. O pino nao muda resposta nenhuma. Com search_path vazio, um corpo que
--    citasse objeto sem schema quebraria aqui, na chamada.
-- ---------------------------------------------------------------------------

SELECT pg_temp.assert_true(
  public.custom_domain_limit_for_plan(NULL) = 0
    AND public.custom_domain_limit_for_plan('free') = 0
    AND public.custom_domain_limit_for_plan('starter') = 1
    AND public.custom_domain_limit_for_plan('pro') = 3
    AND public.custom_domain_limit_for_plan('plus') = 5,
  'custom_domain_limit_for_plan mudou de resposta'
);

SELECT pg_temp.assert_true(
  public.landing_block_limit_for_plan(NULL) = 4
    AND public.landing_block_limit_for_plan('free') = 4
    AND public.landing_block_limit_for_plan('starter') = 8
    AND public.landing_block_limit_for_plan('pro') = 20
    AND public.landing_block_limit_for_plan('plus') = 20,
  'landing_block_limit_for_plan mudou de resposta'
);

SELECT pg_temp.assert_true(
  public.landing_template_allowed('free', 'classic')
    AND public.landing_template_allowed(NULL, 'classic')
    AND NOT public.landing_template_allowed('free', 'bold')
    AND NOT public.landing_template_allowed(NULL, 'bold')
    AND public.landing_template_allowed('starter', 'bold'),
  'landing_template_allowed mudou de resposta'
);

ROLLBACK;

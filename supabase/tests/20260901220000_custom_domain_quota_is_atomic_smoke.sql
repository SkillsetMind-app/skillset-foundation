\set ON_ERROR_STOP on

-- Seguro contra banco vivo: a troca de plano e os domínios reivindicados ficam
-- dentro desta transação e são desfeitos no ROLLBACK.
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

-- `claim_custom_domain` contava os domínios do dono e inseria sem travar nada
-- no meio. Em READ COMMITTED, duas chamadas simultâneas liam o mesmo count, as
-- duas passavam pela cota e as duas inseriam: um professor em starter (cota 1)
-- ficava com N domínios, cada um anexado ao projeto Vercel da plataforma.
--
-- A corrida em si não cabe numa sessão só de psql. O que ESTA sessão prova, no
-- banco de verdade: (1) a definição viva trava a linha do dono em `users` com
-- `for update` ANTES da contagem — `.` casa quebra de linha no regex padrão do
-- Postgres, então a ordem faz parte da asserção; e (2) a cota continua valendo
-- depois da redefinição, como o professor logado a enxerga.
SELECT pg_temp.assert_true(
  pg_get_functiondef('public.claim_custom_domain(text)'::regprocedure)
    ~* 'from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s+for\s+update.*count\(\*\)',
  'claim_custom_domain must lock the owner row (for update) before counting domains'
);

-- Um usuário sem domínio, posto em starter (cota 1) só dentro desta transação.
-- O trigger users_field_guard recusa mudar o plano sem a flag de escrita
-- confiável; ela é local à transação e morre no ROLLBACK junto com o resto.
SELECT u.uid AS test_uid
FROM public.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.custom_domains d WHERE d.owner_uid = u.uid
)
LIMIT 1
\gset

SELECT set_config('skillset.trusted_write', 'on', true);
UPDATE public.users SET current_plan_id = 'starter' WHERE uid = :'test_uid';
SELECT set_config('skillset.trusted_write', 'off', true);

SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_id text;
BEGIN
  v_id := public.claim_custom_domain('smoke-quota-a.example');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: first claim within quota was refused';
  END IF;

  BEGIN
    PERFORM public.claim_custom_domain('smoke-quota-b.example');
    RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: second claim on a 1-domain plan was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'domain quota reached%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

RESET ROLE;

ROLLBACK;

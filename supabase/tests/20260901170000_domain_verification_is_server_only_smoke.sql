\set ON_ERROR_STOP on

-- Seguro contra banco vivo: só lê catálogo de permissões, não escreve nada.
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

-- `claim_custom_domain` promete, no próprio corpo, que um domínio "nunca nasce
-- active — a Vercel é quem decide". `sync_own_custom_domain` desfazia isso:
-- era EXECUTE para `authenticated` e gravava o status vindo do argumento, então
-- o criador podia chamá-la pelo PostgREST com o próprio JWT e declarar
-- verificado um hostname que nunca passou pela Vercel — entrando em
-- `public_domains`, que é o que o proxy lê para decidir de quem é a vitrine
-- servida naquele host.
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_own_custom_domain(text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.sync_own_custom_domain(text,text,text,text,text)',
    'EXECUTE'
  ),
  'sync_own_custom_domain must not be reachable by an end-user role'
);

-- A substituta é service-role apenas: o status de verificação é fato do
-- servidor (a rota acabou de perguntar à Vercel), nunca declaração do dono.
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.sync_custom_domain_status(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'sync_custom_domain_status must be service-role-only'
);

ROLLBACK;

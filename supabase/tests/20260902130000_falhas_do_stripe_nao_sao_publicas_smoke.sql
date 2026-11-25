\set ON_ERROR_STOP on

-- Safe against a live database: nothing is written. The role switches are `set local`
-- and die in the ROLLBACK together with the transaction.
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

-- (1) The structural property: the view consults the base table's RLS instead of
-- crossing it with the owner's privileges. Without this, an accidental grant brings back
-- the exposure of the whole table instead of zero rows.
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

-- (2) The privilege property: none of the four verbs is left for the two
-- roles that PostgREST exposes without a server credential.
SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    papel.nome, 'public.stripe_events_needing_attention', p.priv
  ),
  format('%s must not hold %s on stripe_events_needing_attention', papel.nome, p.priv)
)
FROM (VALUES ('anon'), ('authenticated')) AS papel(nome)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);

-- (3) The behavior proof, not just a catalog one: as anon, the view must
-- refuse the read. `permission denied` (42501) is the expected result;
-- any row returned here is the regression this migration closes.
DO $$
DECLARE
  view_rows int;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO view_rows FROM public.stripe_events_needing_attention;
    RESET ROLE;
    RAISE EXCEPTION
      'SMOKE_ASSERTION_FAILED: anon read stripe_events_needing_attention (% rows)', view_rows;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END;
$$;

-- (4) The legitimate path still stands: the service role sees the view. The
-- count does not matter (zero is the healthy state); what is asserted is that the
-- query runs without a privilege error.
DO $$
DECLARE
  view_rows int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO view_rows FROM public.stripe_events_needing_attention;
  RESET ROLE;
  PERFORM pg_temp.assert_true(
    view_rows >= 0, 'service_role must still be able to read the view'
  );
END;
$$;

ROLLBACK;

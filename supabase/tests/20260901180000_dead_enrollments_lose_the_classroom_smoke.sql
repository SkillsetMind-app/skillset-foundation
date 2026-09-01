\set ON_ERROR_STOP on

-- Seguro contra banco vivo: só lê o catálogo de políticas, não escreve nada.
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

-- A escrita na sala de aula paga precisa do mesmo direito que a leitura. Sem
-- isto, um ex-aluno (reembolsado, revogado, expirado) continua publicando num
-- lugar que ele já não pode ler — a linha de `enrollments` nunca é apagada, só
-- muda de status, e o predicado antigo só perguntava se ela existia.
SELECT pg_temp.assert_true(
  COALESCE(
    pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%e.status%',
    false
  ),
  'lesson_comments_insert must require a live enrollment (active/completed)'
)
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'lesson_comments'
  AND p.polname = 'lesson_comments_insert';

-- E a política tem de existir: um SELECT sem linhas não roda a asserção acima,
-- então o zero-row seria um verde falso.
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'lesson_comments'
      AND p.polname = 'lesson_comments_insert'
  ),
  'lesson_comments_insert policy is missing'
);

-- A guarda inteira, contra o banco de verdade: nenhuma política pode consultar
-- `enrollments` sem consultar o status junto — em USING **ou** em WITH CHECK.
-- A versão de 20260809080000 lia só `polqual` (USING) e por isso passava por
-- cima de toda política de INSERT.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    CROSS JOIN LATERAL (
      SELECT COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
        || ' '
        || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS predicado
    ) x
    WHERE x.predicado ILIKE '%enrollments%'
      AND x.predicado NOT ILIKE '%e.status%'
      -- Exceção documentada: devolve o histórico do PRÓPRIO usuário, que é dele
      -- qualquer que seja o status da matrícula.
      AND p.polname <> 'lesson_progress_select_owner'
  ),
  'some RLS policy reads enrollments without checking status'
);

ROLLBACK;

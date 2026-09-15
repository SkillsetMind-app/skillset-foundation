\set ON_ERROR_STOP on

-- Seguro contra banco vivo: a matricula e o certificado de teste nascem e
-- morrem dentro desta transacao, desfeitos no ROLLBACK do fim.
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

-- Reembolso integral ou chargeback perdido: o webhook do Stripe grava o
-- certificado como 'refund_revoked'. Quem compra o curso de novo e conclui tem
-- de conseguir o certificado de volta. Uma revogacao da operacao ('revoked')
-- continua definitiva. Este arquivo prova as duas metades direto no RPC de
-- emissao, que e quem decide.

SELECT u.id::text AS test_uid
FROM auth.users u
LIMIT 1
\gset

SELECT c.id AS test_course
FROM public.courses c
WHERE NOT EXISTS (
  SELECT 1 FROM public.enrollments e
  WHERE e.user_id = :'test_uid' AND e.course_id = c.id
)
LIMIT 1
\gset

SELECT 'smoke-cert-rebuy__' || :'test_uid' AS test_enrollment
\gset

SELECT set_config('smoke.enrollment', :'test_enrollment', true);

-- Matricula concluida: o estado depois da recompra, com o progresso mantido.
INSERT INTO public.enrollments (
  id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, progress_percent, created_at, updated_at
) VALUES (
  :'test_enrollment', :'test_uid', :'test_course', 'smoke-cert-rebuy',
  'Smoke Cert Rebuy', 'smoke', '', 'completed', 'admin', 100, now(), now()
);

-- O certificado que o reembolso anterior retirou.
INSERT INTO public.certificates (
  id, enrollment_id, user_id, course_id, course_slug, course_title,
  course_category, authority_label, status, verification_code,
  issued_at, created_at, updated_at
) VALUES (
  :'test_enrollment', :'test_enrollment', :'test_uid', :'test_course',
  'smoke-cert-rebuy', 'Smoke Cert Rebuy', 'smoke', 'SkillsetMind Verified',
  'refund_revoked', 'SK-SMOKE-REBUY-0915', now(), now(), now()
);

-- Enquanto retirado, a verificacao publica nao atesta.
SELECT pg_temp.assert_true(
  (public.verify_skillset_certificate('SK-SMOKE-REBUY-0915', 'smoke') ->> 'valid')::boolean = false,
  'certificado refund_revoked nao pode ser atestado pela verificacao publica'
);

-- 1. Recompra: o aluno pede o certificado de novo e ele volta a 'issued'.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'test_uid', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_uid', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.issue_skillset_certificate(:'test_enrollment', 'Smoke Learner');
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT status = 'issued' FROM public.certificates WHERE id = :'test_enrollment'),
  'refund_revoked precisa voltar a issued quando o aluno compra de novo e conclui'
);
SELECT pg_temp.assert_true(
  (public.verify_skillset_certificate('SK-SMOKE-REBUY-0915', 'smoke') ->> 'valid')::boolean = true,
  'depois de reemitido, o mesmo codigo volta a ser atestado'
);

-- 2. Revogacao da operacao: continua bloqueando a reemissao.
UPDATE public.certificates SET status = 'revoked' WHERE id = :'test_enrollment';

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.issue_skillset_certificate(current_setting('smoke.enrollment'), 'Smoke Learner');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: certificado revogado pela operacao foi reemitido';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'SMOKE_ASSERTION_FAILED%' THEN
    RAISE;
  END IF;
  IF SQLERRM NOT LIKE '%revoked by Skillset operations%' THEN
    RAISE;
  END IF;
END $$;
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT status = 'revoked' FROM public.certificates WHERE id = :'test_enrollment'),
  'a tentativa bloqueada nao pode mudar o status revoked'
);

ROLLBACK;

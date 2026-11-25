\set ON_ERROR_STOP on

-- Safe against a live database: the test enrollment and certificate are born and
-- die inside this transaction, undone in the ROLLBACK at the end.
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

-- Full refund or lost chargeback: the Stripe webhook writes the
-- certificate as 'refund_revoked'. Whoever buys the course again and finishes must
-- be able to get the certificate back. A revocation by operations ('revoked')
-- stays final. This file proves both halves directly on the issuance RPC,
-- which is the one that decides.

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

-- Finished enrollment: the state after the repurchase, with progress kept.
INSERT INTO public.enrollments (
  id, user_id, course_id, course_slug, course_title, course_category,
  course_image, status, source, progress_percent, created_at, updated_at
) VALUES (
  :'test_enrollment', :'test_uid', :'test_course', 'smoke-cert-rebuy',
  'Smoke Cert Rebuy', 'smoke', '', 'completed', 'admin', 100, now(), now()
);

-- Since 20261005010000 issuance measures completion against the current curriculum
-- (one lesson_progress row per lesson), not the stored progress_percent. The
-- test course gets a lesson and the enrollment completes it.
UPDATE public.courses
SET modules = '[{"id": "smoke-cert-rebuy-m1", "title": "Smoke", "lessons": [{"id": "smoke-cert-rebuy-a", "title": "Smoke", "type": "text"}]}]'::jsonb
WHERE id = :'test_course';
INSERT INTO public.lesson_progress (enrollment_id, lesson_id, user_id)
VALUES (:'test_enrollment', 'smoke-cert-rebuy-a', :'test_uid');

-- The certificate that the previous refund withdrew.
INSERT INTO public.certificates (
  id, enrollment_id, user_id, course_id, course_slug, course_title,
  course_category, authority_label, status, verification_code,
  issued_at, created_at, updated_at
) VALUES (
  :'test_enrollment', :'test_enrollment', :'test_uid', :'test_course',
  'smoke-cert-rebuy', 'Smoke Cert Rebuy', 'smoke', 'SkillsetMind Verified',
  'refund_revoked', 'SK-SMOKE-REBUY-0915', now(), now(), now()
);

-- While withdrawn, public verification does not attest it.
SELECT pg_temp.assert_true(
  (public.verify_skillset_certificate('SK-SMOKE-REBUY-0915', 'smoke') ->> 'valid')::boolean = false,
  'a refund_revoked certificate must not be attested by the public verification'
);

-- 1. Repurchase: the learner asks for the certificate again and it goes back to 'issued'.
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
  'refund_revoked must go back to issued when the learner buys again and completes'
);
SELECT pg_temp.assert_true(
  (public.verify_skillset_certificate('SK-SMOKE-REBUY-0915', 'smoke') ->> 'valid')::boolean = true,
  'once reissued, the same code is attested again'
);

-- 2. Revocation by operations: it keeps blocking reissue.
UPDATE public.certificates SET status = 'revoked' WHERE id = :'test_enrollment';

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.issue_skillset_certificate(current_setting('smoke.enrollment'), 'Smoke Learner');
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: a certificate revoked by operations was reissued';
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
  'the blocked attempt must not change the revoked status'
);

ROLLBACK;

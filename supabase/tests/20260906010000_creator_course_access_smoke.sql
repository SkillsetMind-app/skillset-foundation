\set ON_ERROR_STOP on
-- CI's disposable Supabase database only. No live account or email transport.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: %', message; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege OR raise_exception OR invalid_parameter_value THEN RETURN; END;
  RAISE EXCEPTION 'SMOKE_ASSERTION_FAILED: accepted %', statement;
END $$;
CREATE FUNCTION pg_temp.actor(uid text, aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub', uid, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
END $$;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
('22222222-2222-4222-8222-222222222222','authenticated','authenticated','grant-learner@example.test',now(),'{}','{}',now(),now()),
('33333333-3333-4333-8333-333333333333','authenticated','authenticated','unconfirmed@example.test',null,'{}','{}',now(),now()),
('44444444-4444-4444-8444-444444444444','authenticated','authenticated','other@example.test',now(),'{}','{}',now(),now());
UPDATE public.courses SET status = 'published' WHERE id = 'smoke-ci-course';
SELECT pg_temp.actor('11111111-1111-4111-8111-111111111111');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.grant_course_access('smoke-ci-course', ' GRANT-LEARNER@example.test ');
SELECT public.grant_course_access('smoke-ci-course', 'grant-learner@example.test');
SELECT public.grant_course_access('smoke-ci-course', 'unconfirmed@example.test');
SELECT public.grant_course_access('smoke-ci-course', 'pending@example.test');
SELECT public.grant_course_access('smoke-ci-course', 'revoked-pending@example.test');
SELECT public.revoke_course_access(id) FROM public.course_access_grants WHERE learner_email='revoked-pending@example.test';
SELECT set_config('smoke.grant',(SELECT id::text FROM public.course_access_grants WHERE learner_email='grant-learner@example.test'),true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.course_access_grants WHERE learner_email='grant-learner@example.test')=1, 'duplicate normalized grant');
SELECT pg_temp.denied($q$SELECT public.grant_course_access('smoke-ci-course', 'bad email')$q$);
SELECT pg_temp.denied($q$UPDATE public.course_access_grants SET learner_email='stolen@example.test'$q$);
SELECT pg_temp.denied($q$INSERT INTO public.course_access_grants(course_id,learner_email,granted_by) VALUES('smoke-ci-course','direct@example.test',auth.uid()::text)$q$);
SELECT pg_temp.denied($q$DELETE FROM public.course_access_grants$q$);
SELECT pg_temp.denied($q$SELECT public.apply_course_access_grant(current_setting('smoke.grant')::uuid,auth.uid())$q$);
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.enrollments WHERE id='22222222-2222-4222-8222-222222222222__smoke-ci-course' AND source='creator')=1, 'confirmed account must receive canonical enrollment');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='33333333-3333-4333-8333-333333333333'), 'unconfirmed email must remain pending');
UPDATE public.users SET email='pending@example.test' WHERE uid='44444444-4444-4444-8444-444444444444';
UPDATE public.users SET roles='["teacher"]'::jsonb WHERE uid='44444444-4444-4444-8444-444444444444';
SELECT pg_temp.actor('44444444-4444-4444-8444-444444444444');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
SELECT pg_temp.assert_true((SELECT count(*) FROM public.course_access_grants)=0, 'learner must not read owner grants');
SELECT pg_temp.denied($q$SELECT public.grant_course_access('smoke-ci-course', 'other@example.test')$q$);
SELECT pg_temp.denied($q$SELECT public.revoke_course_access(current_setting('smoke.grant')::uuid)$q$);
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='44444444-4444-4444-8444-444444444444'), 'profile email must not claim Auth email');
SELECT pg_temp.actor('33333333-3333-4333-8333-333333333333');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='33333333-3333-4333-8333-333333333333'), 'unconfirmed self claim must not enroll');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='33333333-3333-4333-8333-333333333333';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
SELECT public.claim_my_course_grants();
SELECT pg_temp.denied($q$UPDATE public.enrollments SET creator_grant_id=null WHERE user_id=auth.uid()::text$q$);
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.enrollments WHERE user_id='33333333-3333-4333-8333-333333333333')=1, 'confirmed self claim must be idempotent');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.notifications WHERE user_id='33333333-3333-4333-8333-333333333333' AND type='enrollment')=1, 'retry must not duplicate notification');

-- A completed manual enrollment keeps its history and certificate on revocation.
UPDATE public.enrollments SET status='completed',progress_percent=100,last_lesson_id='final' WHERE user_id='22222222-2222-4222-8222-222222222222';
INSERT INTO public.certificates(id,enrollment_id,user_id,course_id,course_slug,course_title,course_category,verification_code)
VALUES ('manual-smoke-cert','22222222-2222-4222-8222-222222222222__smoke-ci-course','22222222-2222-4222-8222-222222222222','smoke-ci-course','smoke-ci-course','Smoke CI','smoke','manual-smoke-cert');
UPDATE public.courses SET status='draft' WHERE id='smoke-ci-course';
SELECT pg_temp.actor('11111111-1111-4111-8111-111111111111');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.revoke_course_access(id) FROM public.course_access_grants WHERE learner_email='grant-learner@example.test';
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT status='revoked' AND progress_percent=100 AND last_lesson_id='final' FROM public.enrollments WHERE user_id='22222222-2222-4222-8222-222222222222'), 'revoke must preserve progress');
SELECT pg_temp.assert_true(EXISTS(SELECT FROM public.certificates WHERE id='manual-smoke-cert'), 'revoke must preserve certificate');
UPDATE public.courses SET status='published' WHERE id='smoke-ci-course';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.grant_course_access('smoke-ci-course','grant-learner@example.test');
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT status='completed' AND progress_percent=100 FROM public.enrollments WHERE user_id='22222222-2222-4222-8222-222222222222'), 'regrant must preserve completion');

-- A payment acquired later is never converted or revoked by the creator grant.
UPDATE public.enrollments SET source='subscription',subscription_id='sub-smoke',status='active' WHERE user_id='22222222-2222-4222-8222-222222222222';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.grant_course_access('smoke-ci-course','grant-learner@example.test');
SELECT pg_temp.assert_true((SELECT access_status='preserved' FROM public.course_access_grants WHERE learner_email='grant-learner@example.test'), 'active payment preserved');
SELECT public.revoke_course_access(id) FROM public.course_access_grants WHERE learner_email='grant-learner@example.test';
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT source='subscription' AND subscription_id='sub-smoke' AND status='active' FROM public.enrollments WHERE user_id='22222222-2222-4222-8222-222222222222'), 'creator revoke touched Stripe');
UPDATE public.enrollments SET status='revoked' WHERE user_id='22222222-2222-4222-8222-222222222222';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.grant_course_access('smoke-ci-course','grant-learner@example.test');
SELECT pg_temp.assert_true((SELECT access_status='conflict' FROM public.course_access_grants WHERE learner_email='grant-learner@example.test'), 'revoked Stripe requires support');
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true((SELECT status='revoked' FROM public.enrollments WHERE user_id='22222222-2222-4222-8222-222222222222'), 'regrant must not reactivate Stripe');

-- Auth email reuse cannot reassign the previously claimed grant.
UPDATE auth.users SET email='changed@example.test' WHERE id='33333333-3333-4333-8333-333333333333';
UPDATE auth.users SET email='unconfirmed@example.test' WHERE id='44444444-4444-4444-8444-444444444444';
SELECT pg_temp.actor('44444444-4444-4444-8444-444444444444');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='44444444-4444-4444-8444-444444444444'), 'reused email stole a grant');

-- A pending claim rechecks publication and owner at consumption time.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('55555555-5555-4555-8555-555555555555','authenticated','authenticated','pending@example.test',now(),'{}','{}',now(),now());
UPDATE public.courses SET status='draft' WHERE id='smoke-ci-course';
SELECT pg_temp.actor('55555555-5555-4555-8555-555555555555');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='55555555-5555-4555-8555-555555555555'), 'unpublished course was claimed');
UPDATE public.courses SET status='published',owner_id='44444444-4444-4444-8444-444444444444' WHERE id='smoke-ci-course';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='55555555-5555-4555-8555-555555555555'), 'transferred course was claimed');
UPDATE public.courses SET owner_id='11111111-1111-4111-8111-111111111111' WHERE id='smoke-ci-course';
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SELECT pg_temp.assert_true(EXISTS(SELECT FROM public.enrollments WHERE user_id='55555555-5555-4555-8555-555555555555'), 'eligible pending claim cannot retry');

-- Fulfillment uses the CURRENT locked enrollment. Both race orderings stay paid.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('66666666-6666-4666-8666-666666666666','authenticated','authenticated','revoked-pending@example.test',now(),'{}','{}',now(),now());
SELECT pg_temp.actor('66666666-6666-4666-8666-666666666666');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.claim_my_course_grants();
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.enrollments WHERE user_id='66666666-6666-4666-8666-666666666666'), 'revoked pending grant revived on signup');
SELECT pg_temp.actor('11111111-1111-4111-8111-111111111111');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT public.revoke_course_access(id) FROM public.course_access_grants WHERE learner_email='pending@example.test';
SELECT pg_temp.denied($q$SELECT public.fulfill_paid_course_access(auth.uid()::text,'smoke-ci-course','payment')$q$);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.fulfill_paid_course_access('55555555-5555-4555-8555-555555555555','smoke-ci-course','payment');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='active' AND source='payment' AND creator_grant_id IS NULL FROM public.enrollments WHERE user_id='55555555-5555-4555-8555-555555555555'), 'revocation before payment left paid access revoked');
SELECT public.fulfill_paid_course_access('33333333-3333-4333-8333-333333333333','smoke-ci-course','subscription','sub-smoke-atomic');
SELECT pg_temp.actor('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT public.revoke_course_access(id) FROM public.course_access_grants WHERE learner_email='unconfirmed@example.test';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='active' AND source='subscription' AND subscription_id='sub-smoke-atomic' AND creator_grant_id IS NULL FROM public.enrollments WHERE user_id='33333333-3333-4333-8333-333333333333'), 'revocation after payment revoked paid access');
SELECT set_config('skillset.trusted_write','on',true);
UPDATE public.enrollments SET status='completed',progress_percent=100,last_lesson_id='final' WHERE user_id='55555555-5555-4555-8555-555555555555';
SELECT set_config('skillset.trusted_write','off',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.fulfill_paid_course_access('55555555-5555-4555-8555-555555555555','smoke-ci-course','payment');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='completed' AND progress_percent=100 AND last_lesson_id='final' FROM public.enrollments WHERE user_id='55555555-5555-4555-8555-555555555555'), 'paid redelivery reset completion');

INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','totp','verified',now(),now());
SELECT pg_temp.actor('11111111-1111-4111-8111-111111111111','aal1');
SELECT set_config('skillset.trusted_write','off',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.course_access_grants)=0, 'MFA pending listed grants');
SELECT pg_temp.denied($q$SELECT public.grant_course_access('smoke-ci-course','mfa@example.test')$q$);
SELECT pg_temp.denied($q$SELECT public.claim_my_course_grants()$q$);
SELECT pg_temp.denied($q$SELECT public.revoke_course_access(current_setting('smoke.grant')::uuid)$q$);
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
SET LOCAL ROLE anon;
SELECT pg_temp.denied($q$SELECT public.fulfill_paid_course_access('55555555-5555-4555-8555-555555555555','smoke-ci-course','payment')$q$);
SELECT pg_temp.denied($q$SELECT public.grant_course_access('smoke-ci-course','anon@example.test')$q$);
SELECT pg_temp.denied($q$SELECT public.claim_my_course_grants()$q$);
RESET ROLE;
SELECT set_config('skillset.trusted_write','on',true);
ROLLBACK;

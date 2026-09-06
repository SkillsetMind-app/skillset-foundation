\set ON_ERROR_STOP on
-- Run only in the disposable Supabase test database. All fixtures roll back.
BEGIN;
CREATE TEMP TABLE security_checks (name text, passed boolean);
GRANT INSERT, SELECT ON security_checks TO anon, authenticated;
CREATE FUNCTION pg_temp.check_security(p_name text, p_ok boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO security_checks VALUES (p_name, coalesce(p_ok,false)); $$;
CREATE FUNCTION pg_temp.assume_session(p_uid uuid, p_role text, p_aal text DEFAULT 'aal1') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',coalesce(p_uid::text,''),true);
  PERFORM set_config('request.jwt.claim.role',p_role,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role',p_role,'aal',p_aal)::text,true);
END $$;
CREATE FUNCTION pg_temp.write_succeeded(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
-- Roll back even a successful write, then report whether authorization denied it.
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION USING ERRCODE='Z0001';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN true;
  WHEN SQLSTATE 'Z0001' THEN RETURN false;
END $$;
CREATE FUNCTION pg_temp.foreign_key_denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RAISE EXCEPTION USING ERRCODE='Z0001';
EXCEPTION WHEN foreign_key_violation THEN RETURN true;
  WHEN SQLSTATE 'Z0001' THEN RETURN false;
END $$;

SELECT gen_random_uuid() AS teacher_uid, gen_random_uuid() AS admin_uid, gen_random_uuid() AS student_uid, gen_random_uuid() AS other_teacher_uid \gset
SELECT pg_temp.assume_session(null,'service_role');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
  (:'teacher_uid','authenticated','authenticated',:'teacher_uid' || '@example.invalid',now(),now(),now(),'{}','{}'),
  (:'admin_uid','authenticated','authenticated',:'admin_uid' || '@example.invalid',now(),now(),now(),'{}','{}'),
  (:'student_uid','authenticated','authenticated',:'student_uid' || '@example.invalid',now(),now(),now(),'{}','{}'),
  (:'other_teacher_uid','authenticated','authenticated',:'other_teacher_uid' || '@example.invalid',now(),now(),now(),'{}','{}');
UPDATE public.users SET roles='["student","teacher"]',teacher_terms_accepted_at=now(),teacher_terms_version='audit-test',activation_fee_paid_at=now()
WHERE uid IN (:'teacher_uid',:'admin_uid',:'other_teacher_uid');
UPDATE public.users SET roles='["student","teacher","admin"]' WHERE uid=:'admin_uid';

INSERT INTO public.courses(id,owner_id,slug,title,title_key,summary,category,status,payment_type,price_amount_minor,currency,community_enabled)
VALUES
 ('audit-boundaries-own',:'teacher_uid','audit-boundaries-own-slug','Own course','audit-boundaries-own','Course for isolated security tests.','smoke','published','one_time',100,'USD',true),
 ('audit-boundaries-other',:'admin_uid','audit-boundaries-other-slug','Other course','audit-boundaries-other','Course for isolated security tests.','smoke','published','one_time',100,'USD',true),
 ('audit-slug-reuser',:'other_teacher_uid','audit-reuser-original','Reuser course','audit-reuser','Course for isolated security tests.','smoke','published','free',0,'USD',true),
 ('audit-retained-community',:'teacher_uid','audit-retained-community-slug','Retained community','audit-retained-community','Course for isolated security tests.','smoke','draft','free',0,'USD',true),
 ('audit-retained-event',:'teacher_uid','audit-retained-event-slug','Retained event','audit-retained-event','Course for isolated security tests.','smoke','draft','free',0,'USD',false),
 ('audit-empty-draft',:'teacher_uid','audit-empty-draft-slug','Empty draft','audit-empty-draft','Course for isolated security tests.','smoke','draft','free',0,'USD',false),
 ('audit-admin-empty',:'teacher_uid','audit-admin-empty-slug','Admin deletion','audit-admin-empty','Course for isolated security tests.','smoke','published','free',0,'USD',false);
INSERT INTO public.enrollments(id,user_id,course_id,course_slug,course_title,course_category,course_image,status,source)
VALUES
 (:'student_uid' || '__audit-boundaries-own',:'student_uid','audit-boundaries-own','audit-boundaries-own','Own course','smoke','','active','admin'),
 (:'teacher_uid' || '__audit-boundaries-other',:'teacher_uid','audit-boundaries-other','audit-boundaries-other','Other course','smoke','','active','admin');
INSERT INTO public.community_posts(id,course_slug,author_id,author_name,author_role,category,body,pinned)
VALUES
 ('audit-boundaries-post','audit-boundaries-other',:'admin_uid','Test creator','teacher','question','Synthetic question.',false),
 ('audit-own-post','audit-boundaries-own',:'student_uid','Test learner','student','question','Learner question.',false),
 ('audit-own-legacy-post','audit-boundaries-own-slug',:'student_uid','Test learner','student','question','Legacy question.',false),
 ('audit-retained-post','audit-retained-community-slug',:'teacher_uid','Test creator','teacher','question','Retained question.',false);
INSERT INTO public.community_comments(id,post_id,course_slug,author_id,author_name,author_role,body)
VALUES('audit-legacy-comment','audit-own-legacy-post','audit-boundaries-own-slug',:'student_uid','Test learner','student','Legacy comment.');
INSERT INTO public.course_events(id,course_id,course_slug,course_title,owner_id,title,description,type,status,starts_at,external_url)
VALUES
 ('audit-own-event','audit-boundaries-own','audit-boundaries-own','Own course',:'teacher_uid','Own event','Synthetic event.','live','scheduled','2026-10-01T12:00:00Z','https://example.invalid/live'),
 ('audit-old-rsvp-event','audit-boundaries-own','audit-boundaries-own','Own course',:'teacher_uid','Existing event','Synthetic event.','live','scheduled','2026-10-01T12:00:00Z','https://example.invalid/live'),
 ('audit-wrong-label-event','audit-boundaries-other','audit-boundaries-own','Other course',:'admin_uid','Other event','Synthetic event.','live','scheduled','2026-10-01T12:00:00Z','https://example.invalid/live'),
 ('audit-cancelled-event','audit-boundaries-own','audit-boundaries-own','Own course',:'teacher_uid','Cancelled event','Synthetic event.','live','cancelled','2026-10-01T12:00:00Z','https://example.invalid/live'),
 ('audit-retained-event-row','audit-retained-event','audit-retained-event','Retained course',:'teacher_uid','Retained event','Synthetic event.','live','scheduled','2026-10-01T12:00:00Z','https://example.invalid/live');
-- A historical RSVP carries another course's label. Its owner can read the
-- event as its teacher, but their enrollment is in course B, not this event A.
INSERT INTO public.course_event_rsvps(event_id,uid,course_slug,user_id,attendee_name,status)
VALUES('audit-old-rsvp-event',:'teacher_uid','audit-boundaries-other',:'teacher_uid','Test creator','going');
INSERT INTO public.course_lesson_content(lesson_id,course_id,content_text)
VALUES('audit-other-private','audit-boundaries-other','OTHER_PRIVATE_LESSON_TEST');
INSERT INTO storage.objects(bucket_id,name)
VALUES('course-content','courses/audit-boundaries-own/assets/audit.txt');

-- The normal builder must keep the private copy while removing it from the public row.
SELECT pg_temp.assume_session(:'teacher_uid','authenticated');
SET LOCAL ROLE authenticated;
SELECT public.update_teacher_course_builder('audit-boundaries-own', '{
 "title":"Own course","summary":"Course for isolated security tests.","categories":["smoke"],
 "paymentType":"one_time","priceAmountMinor":100,"currency":"USD","communityEnabled":true,
 "freePreviewLessonId":"audit-preview","modules":[{"id":"audit-module","title":"Module","lessons":[
   {"id":"audit-private","title":"Paid lesson","description":"Paid","type":"text","contentText":"PRIVATE_LESSON_TEST","externalUrl":"https://example.invalid/private"},
   {"id":"audit-preview","title":"Preview","description":"Preview","type":"text","contentText":"PUBLIC_PREVIEW_TEST","externalUrl":"https://example.invalid/preview"}
 ]}]
}');
SELECT pg_temp.check_security('builder retains the private lesson',
  (SELECT content_text='PRIVATE_LESSON_TEST' FROM public.course_lesson_content WHERE lesson_id='audit-private'));
SELECT pg_temp.check_security('teacher reads own community by ID and legacy slug',
 (SELECT count(*)=2 FROM public.community_posts WHERE id IN ('audit-own-post','audit-own-legacy-post')));
SELECT pg_temp.check_security('new legacy community references are stored as canonical IDs',
 (SELECT course_slug='audit-boundaries-own' FROM public.community_posts WHERE id='audit-own-legacy-post')
 AND (SELECT course_slug='audit-boundaries-own' FROM public.community_comments WHERE id='audit-legacy-comment'));
SELECT pg_temp.check_security('teacher update writer accepts the authenticated owner',pg_temp.write_succeeded(format(
 'INSERT INTO public.community_posts(id,course_slug,author_id,author_name,author_role,category,body) VALUES(%L,%L,%L,%L,%L,%L,%L)',
 'audit-teacher-post','audit-boundaries-own',:'teacher_uid','Test creator','admin','announcement','Creator question.')));
SELECT pg_temp.check_security('course owner posts an update without buying their own course',
 EXISTS(SELECT FROM public.community_posts WHERE id='audit-teacher-post' AND author_role='student'));
SELECT pg_temp.check_security('teacher cannot post in an unrelated course',pg_temp.denied(format(
 'INSERT INTO public.community_posts(course_slug,author_id,author_name,author_role,category,body) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-slug-reuser',:'teacher_uid','Test creator','teacher','announcement','Forbidden update.')));
SELECT pg_temp.check_security('teacher can moderate a learner post identified by course ID',
 pg_temp.write_succeeded($$UPDATE public.community_posts SET pinned=true WHERE id='audit-own-post'$$));
SELECT pg_temp.check_security('moderation actually pins the learner post',
 (SELECT pinned FROM public.community_posts WHERE id='audit-own-post'));
SELECT pg_temp.check_security('teacher retains edits and pinning on their own post',
 pg_temp.write_succeeded($$UPDATE public.community_posts SET body='Edited creator question.',pinned=true WHERE id='audit-teacher-post'$$));
SELECT pg_temp.check_security('teacher own post edit and pin actually persist',
 EXISTS(SELECT FROM public.community_posts WHERE id='audit-teacher-post' AND body='Edited creator question.' AND pinned));
SELECT pg_temp.check_security('teacher cannot change the connected account',pg_temp.denied(
  $$UPDATE public.courses SET stripe_connected_account_id='acct_synthetic' WHERE id='audit-boundaries-own'$$));
SELECT pg_temp.check_security('teacher cannot poison the recurring price cache',pg_temp.denied(
  $$UPDATE public.courses SET stripe_subscription_price='{"priceId":"price_synthetic"}' WHERE id='audit-boundaries-own'$$));
SELECT pg_temp.check_security('teacher cannot supply Stripe metadata on INSERT',pg_temp.denied(format(
  'INSERT INTO public.courses(id,owner_id,title,summary,category,status,stripe_connected_account_id) VALUES(%L,%L,%L,%L,%L,%L,%L)',
  'audit-boundaries-insert',:'teacher_uid','Synthetic course','Course for isolated security tests.','smoke','draft','acct_synthetic')));
SELECT pg_temp.check_security('community prevents deleting a referenced course',pg_temp.foreign_key_denied(
 $$DELETE FROM public.courses WHERE id='audit-retained-community'$$));
SELECT pg_temp.check_security('community prevents changing a referenced course ID',pg_temp.foreign_key_denied(
 $$UPDATE public.courses SET id='audit-reused-community-id' WHERE id='audit-retained-community'$$));
SELECT pg_temp.check_security('event prevents deleting a referenced course',pg_temp.foreign_key_denied(
 $$DELETE FROM public.courses WHERE id='audit-retained-event'$$));
SELECT pg_temp.check_security('event prevents changing a referenced course ID',pg_temp.foreign_key_denied(
 $$UPDATE public.courses SET id='audit-reused-event-id' WHERE id='audit-retained-event'$$));
SELECT public.delete_teacher_course_draft('audit-empty-draft');
SELECT pg_temp.check_security('teacher retains deletion of an empty draft',
 NOT EXISTS(SELECT FROM public.courses WHERE id='audit-empty-draft'));
SELECT pg_temp.check_security('RSVP cannot use enrollment in a different course',pg_temp.denied(format(
 'INSERT INTO public.course_event_rsvps(event_id,uid,course_slug,user_id,attendee_name,status) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-own-event',:'teacher_uid','audit-boundaries-other',:'teacher_uid','Test creator','going')));
WITH changed AS (UPDATE public.course_event_rsvps SET status='cancelled' WHERE event_id='audit-old-rsvp-event' AND uid=:'teacher_uid' RETURNING event_id)
SELECT pg_temp.check_security('existing RSVP cannot be updated using another course enrollment',(SELECT count(*)=0 FROM changed));
RESET ROLE;
SELECT pg_temp.assume_session(null,'service_role');
UPDATE public.enrollments SET status='revoked' WHERE user_id=:'teacher_uid' AND course_id='audit-boundaries-other';

SELECT pg_temp.assume_session(null,'anon');
SET LOCAL ROLE anon;
SELECT pg_temp.check_security('public course and curriculum remain readable',
 (SELECT jsonb_array_length(modules)=1 AND jsonb_array_length(modules->0->'lessons')=2 FROM public.courses WHERE id='audit-boundaries-own'));
SELECT pg_temp.check_security('public curriculum contains no lesson text or URLs',
 NOT EXISTS(SELECT FROM public.courses c, jsonb_array_elements(c.modules) m, jsonb_array_elements(m->'lessons') l
 WHERE c.id='audit-boundaries-own' AND (l ? 'contentText' OR l ? 'externalUrl')));
SELECT pg_temp.check_security('anonymous visitor cannot read a paid lesson',
 NOT EXISTS(SELECT FROM public.course_lesson_content WHERE lesson_id='audit-private'));
SELECT pg_temp.check_security('designated public preview still works',
 (SELECT content_text='PUBLIC_PREVIEW_TEST' FROM public.course_lesson_content WHERE lesson_id='audit-preview'));
RESET ROLE;

-- Enrollment and owner still see the private content; unrelated users do not.
SELECT pg_temp.assume_session(:'student_uid','authenticated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('active learner still reads the paid lesson',
 (SELECT content_text='PRIVATE_LESSON_TEST' FROM public.course_lesson_content WHERE lesson_id='audit-private'));
SELECT pg_temp.check_security('active learner resolves canonical IDs and legacy slugs',
 public.has_enrollment_for_course_slug('audit-boundaries-own') AND public.has_enrollment_for_course_slug('audit-boundaries-own-slug'));
SELECT pg_temp.check_security('unrelated learner cannot read another course lesson',
 NOT EXISTS(SELECT FROM public.course_lesson_content WHERE lesson_id='audit-other-private'));
SELECT pg_temp.check_security('event visibility uses its course ID despite a different label',
 NOT EXISTS(SELECT FROM public.course_events WHERE id='audit-wrong-label-event'));
INSERT INTO public.course_event_rsvps(event_id,uid,course_slug,user_id,attendee_name,status)
VALUES('audit-own-event',:'student_uid','audit-boundaries-own',:'student_uid','Test learner','going');
UPDATE public.course_event_rsvps SET status='cancelled' WHERE event_id='audit-own-event' AND uid=:'student_uid';
SELECT pg_temp.check_security('enrolled learner retains RSVP insert and update',
 EXISTS(SELECT FROM public.course_event_rsvps WHERE event_id='audit-own-event' AND uid=:'student_uid' AND status='cancelled'));
SELECT pg_temp.check_security('RSVP still rejects a non-scheduled event',pg_temp.denied(format(
 'INSERT INTO public.course_event_rsvps(event_id,uid,course_slug,user_id,attendee_name,status) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-cancelled-event',:'student_uid','audit-boundaries-own',:'student_uid','Test learner','going')));
SELECT pg_temp.check_security('RSVP still rejects another uid',pg_temp.denied(format(
 'INSERT INTO public.course_event_rsvps(event_id,uid,course_slug,user_id,attendee_name,status) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-own-event',:'admin_uid','audit-boundaries-own',:'admin_uid','Test learner','going')));
INSERT INTO public.community_posts(id,course_slug,author_id,author_name,author_role,category,body)
VALUES('audit-forged-role','audit-boundaries-own',:'student_uid','Test learner','admin','question','Learner question.');
SELECT pg_temp.check_security('post label is derived from the real profile on INSERT',
 (SELECT author_role='student' FROM public.community_posts WHERE id='audit-forged-role'));
UPDATE public.community_posts SET author_role='teacher',body='Edited learner question.' WHERE id='audit-forged-role';
SELECT pg_temp.check_security('post edit cannot promote its author label',
 (SELECT author_role='student' AND body='Edited learner question.' FROM public.community_posts WHERE id='audit-forged-role'));
INSERT INTO public.community_comments(id,post_id,course_slug,author_id,author_name,author_role,body)
VALUES('audit-forged-comment','audit-forged-role','audit-boundaries-own',:'student_uid','Test learner','teacher','Learner comment.');
SELECT pg_temp.check_security('comment label is derived from the real profile on INSERT',
 (SELECT author_role='student' FROM public.community_comments WHERE id='audit-forged-comment'));
SELECT pg_temp.check_security('comment body edit cannot promote its author label',
 pg_temp.write_succeeded($$UPDATE public.community_comments SET author_role='admin',body='Edited learner comment.' WHERE id='audit-forged-comment'$$));
SELECT pg_temp.check_security('comment body and trusted label survive the edit',
 (SELECT author_role='student' AND body='Edited learner comment.' FROM public.community_comments WHERE id='audit-forged-comment'));
SELECT pg_temp.check_security('report writer uses the post despite an untrusted course label',pg_temp.write_succeeded(format(
 'INSERT INTO public.community_reports(id,course_slug,post_id,target_type,reporter_id,reason,status) VALUES(%L,%L,%L,%L,%L,%L,%L)',
 'audit-course-report','untrusted-course-label','audit-teacher-post','post',:'student_uid','spam','open')));
SELECT pg_temp.check_security('report derives its canonical course from the target post',
 EXISTS(SELECT FROM public.community_reports WHERE id='audit-course-report' AND course_slug='audit-boundaries-own'));
SELECT pg_temp.check_security('report cannot borrow membership from its submitted course label',pg_temp.denied(format(
 'INSERT INTO public.community_reports(course_slug,post_id,target_type,reporter_id,reason,status) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-boundaries-own','audit-boundaries-post','post',:'student_uid','spam','open')));
SELECT pg_temp.check_security('comment cannot borrow membership from its submitted course label',pg_temp.denied(format(
 'INSERT INTO public.community_comments(post_id,course_slug,author_id,author_name,author_role,body) VALUES(%L,%L,%L,%L,%L,%L)',
 'audit-boundaries-post','audit-boundaries-own',:'student_uid','Test learner','student','Forbidden comment.')));
RESET ROLE;

-- MFA is checked on the direct SQL surface, including administrative RPCs and Storage.
INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
VALUES(gen_random_uuid(),:'admin_uid','totp','verified',now(),now()),
      (gen_random_uuid(),:'teacher_uid','totp','verified',now(),now());
SELECT pg_temp.assume_session(:'admin_uid','authenticated','aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('aal1 admin cannot grant platform roles',pg_temp.denied(format(
 'SELECT public.admin_set_user_roles(%L,%L::jsonb)',:'student_uid','["student","teacher"]')));
SELECT pg_temp.check_security('aal1 admin cannot read private user profiles',
 NOT EXISTS(SELECT FROM public.users));
SELECT pg_temp.check_security('aal1 still sees public catalog',
 EXISTS(SELECT FROM public.courses WHERE id='audit-boundaries-own'));
RESET ROLE;

SELECT pg_temp.assume_session(:'teacher_uid','authenticated','aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('aal1 teacher cannot read the learner roster RPC',
 NOT EXISTS(SELECT FROM public.get_my_course_students()));
SELECT pg_temp.check_security('aal1 teacher cannot write via a definer RPC',pg_temp.denied(
 $$SELECT public.set_own_course_featured('audit-boundaries-own',false)$$));
SELECT pg_temp.check_security('aal1 teacher cannot read private course files',
 NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id='course-content' AND name='courses/audit-boundaries-own/assets/audit.txt'));
SELECT pg_temp.check_security('aal1 teacher cannot upload private course files',pg_temp.denied(
 $$INSERT INTO storage.objects(bucket_id,name) VALUES('course-content','courses/audit-boundaries-own/assets/blocked.txt')$$));
SELECT pg_temp.check_security('aal1 teacher cannot read private lesson text',
 NOT EXISTS(SELECT FROM public.course_lesson_content WHERE lesson_id='audit-private'));
SELECT pg_temp.check_security('aal1 teacher can still read the public preview',
 EXISTS(SELECT FROM public.course_lesson_content WHERE lesson_id='audit-preview'));
SELECT pg_temp.check_security('aal1 teacher cannot read the private community',
 NOT EXISTS(SELECT FROM public.community_posts WHERE id='audit-own-post'));
RESET ROLE;

SELECT pg_temp.assume_session(:'admin_uid','authenticated','aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('aal2 admin retains the legitimate role operation',NOT pg_temp.denied(format(
 'SELECT public.admin_set_user_roles(%L,%L::jsonb)',:'student_uid','["student","teacher"]')));
SELECT public.delete_course_as_admin('audit-admin-empty');
SELECT pg_temp.check_security('admin retains deletion of an unreferenced course',
 NOT EXISTS(SELECT FROM public.courses WHERE id='audit-admin-empty'));
RESET ROLE;
SELECT pg_temp.assume_session(:'teacher_uid','authenticated','aal2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('aal2 teacher retains the learner roster',
 EXISTS(SELECT FROM public.get_my_course_students() WHERE course_id='audit-boundaries-own'));
SELECT pg_temp.check_security('aal2 teacher retains private course files',
 EXISTS(SELECT FROM storage.objects WHERE bucket_id='course-content' AND name='courses/audit-boundaries-own/assets/audit.txt'));

-- A creator-controlled slug cannot impersonate another course's canonical ID.
UPDATE public.courses SET slug='audit-boundaries-other' WHERE id='audit-boundaries-own';
SELECT pg_temp.check_security('slug matching another course ID does not expose its community',
 NOT EXISTS(SELECT FROM public.community_posts WHERE id='audit-boundaries-post'));
WITH changed AS (UPDATE public.community_posts SET pinned=true WHERE id='audit-boundaries-post' RETURNING id)
SELECT pg_temp.check_security('slug matching another course ID does not grant moderation',(SELECT count(*)=0 FROM changed));
RESET ROLE;
SELECT pg_temp.assume_session(:'student_uid','authenticated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_security('enrollment in a colliding slug does not grant another course access',
 NOT public.has_enrollment_for_course_slug('audit-boundaries-other')
 AND NOT EXISTS(SELECT FROM public.community_posts WHERE id='audit-boundaries-post'));
SELECT pg_temp.check_security('canonical enrollment still works after the creator changes its slug',
 public.has_enrollment_for_course_slug('audit-boundaries-own')
 AND EXISTS(SELECT FROM public.community_posts WHERE id='audit-own-post'));
RESET ROLE;
SELECT pg_temp.assume_session(:'other_teacher_uid','authenticated');
SET LOCAL ROLE authenticated;
UPDATE public.courses SET slug='audit-boundaries-own-slug' WHERE id='audit-slug-reuser';
SELECT pg_temp.check_security('reusing an old slug cannot transfer historical community posts',
 NOT EXISTS(SELECT FROM public.community_posts WHERE id='audit-own-legacy-post'));
SELECT pg_temp.check_security('reusing an old slug cannot transfer historical comments',
 NOT EXISTS(SELECT FROM public.community_comments WHERE id='audit-legacy-comment'));
RESET ROLE;

SELECT pg_temp.assume_session(null,'service_role');
UPDATE public.courses SET stripe_connected_account_id='acct_server_synthetic',stripe_subscription_price='{"priceId":"price_server_synthetic"}'
WHERE id='audit-boundaries-own';
SELECT pg_temp.check_security('server retains the legitimate Stripe metadata write',
 (SELECT stripe_connected_account_id='acct_server_synthetic' AND stripe_subscription_price->>'priceId'='price_server_synthetic'
 FROM public.courses WHERE id='audit-boundaries-own'));

SELECT name, passed FROM security_checks ORDER BY name;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name,', ') INTO failures FROM security_checks WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'SECURITY_BOUNDARY_REGRESSION: %',failures; END IF;
END $$;
ROLLBACK;

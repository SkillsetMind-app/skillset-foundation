-- =============================================================================
-- RLS BASELINE SNAPSHOT
-- =============================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Production has row-level security enabled on all 47 tables in the `public`
-- schema, with 129 policies across 41 of them. The repo's schema baseline
-- (`20260715_schema_baseline_tables_from_types.sql`) creates the tables but
-- contains ZERO `ENABLE ROW LEVEL SECURITY` and ZERO `CREATE POLICY`
-- statements -- it was generated from TypeScript types, which carry no
-- security metadata.
--
-- Consequence: a fresh environment rebuilt from this repo (local dev, a
-- preview branch, or a disaster-recovery restore) would come up with every
-- table wide open to `anon` and `authenticated`. Production is fine; the
-- REPRODUCIBILITY is what was broken. This file closes that gap.
--
-- PROPERTIES
-- ----------
--   * IDEMPOTENT. `ENABLE ROW LEVEL SECURITY` is a no-op when already on, and
--     every policy is preceded by `DROP POLICY IF EXISTS`.
--   * NO-OP AGAINST PRODUCTION. This is a snapshot OF production taken on
--     2026-08-09; applying it there re-creates the exact state that is already
--     live. It is intended to be marked as applied, not to change anything.
--   * DECLARATIVE. Later migrations that alter policies win by ordering. Do
--     not edit this file to change policy behaviour -- write a new migration.
--
-- Snapshot taken: 2026-08-09
--   47 tables, all with RLS enabled (7 additionally FORCEd)
--   129 policies across 41 tables
--   6 tables intentionally have no policies (server-side / service_role only)
--
-- =============================================================================


-- =============================================================================
-- SECTION 1 -- ENABLE ROW LEVEL SECURITY (47 tables)
-- =============================================================================

ALTER TABLE public.account_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_documents ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.advisor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_commerce_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_coupon_reservations ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.course_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_lesson_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_title_keys ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_verification_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_path_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.product_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;  -- no policies: deny-all except service_role (intentional, server-side only)
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 1b -- FORCE ROW LEVEL SECURITY (7 tables)
-- =============================================================================
-- These tables also have relforcerowsecurity = true in production, so RLS
-- applies to the table owner as well. Money and idempotency tables.

ALTER TABLE public.checkout_locks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.course_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payout_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.processed_stripe_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 2 -- POLICIES (129 policies across 41 tables)
-- =============================================================================
-- Reconstructed verbatim from pg_policies. Predicates are shown as Postgres
-- normalised them (extra parens, `::text` casts, and `( SELECT auth.uid() )`
-- wrapping are the planner's output, not hand-written style).

-- account_action_requests
DROP POLICY IF EXISTS account_action_requests_delete_admin ON public.account_action_requests;
CREATE POLICY account_action_requests_delete_admin ON public.account_action_requests AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS account_action_requests_select_admin ON public.account_action_requests;
CREATE POLICY account_action_requests_select_admin ON public.account_action_requests AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS account_action_requests_select_self ON public.account_action_requests;
CREATE POLICY account_action_requests_select_self ON public.account_action_requests AS PERMISSIVE FOR SELECT TO public
  USING ((requested_by = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS account_action_requests_update_admin ON public.account_action_requests;
CREATE POLICY account_action_requests_update_admin ON public.account_action_requests AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- advisor_conversations
DROP POLICY IF EXISTS advisor_conversations_owner_insert ON public.advisor_conversations;
CREATE POLICY advisor_conversations_owner_insert ON public.advisor_conversations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((teacher_id = ( SELECT auth.uid() AS uid)));
DROP POLICY IF EXISTS advisor_conversations_owner_read ON public.advisor_conversations;
CREATE POLICY advisor_conversations_owner_read ON public.advisor_conversations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((teacher_id = ( SELECT auth.uid() AS uid)));

-- advisor_messages
DROP POLICY IF EXISTS advisor_messages_owner_insert ON public.advisor_messages;
CREATE POLICY advisor_messages_owner_insert ON public.advisor_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM advisor_conversations c
  WHERE ((c.id = advisor_messages.conversation_id) AND (c.teacher_id = ( SELECT auth.uid() AS uid))))));
DROP POLICY IF EXISTS advisor_messages_owner_read ON public.advisor_messages;
CREATE POLICY advisor_messages_owner_read ON public.advisor_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM advisor_conversations c
  WHERE ((c.id = advisor_messages.conversation_id) AND (c.teacher_id = ( SELECT auth.uid() AS uid))))));

-- audit_log
DROP POLICY IF EXISTS audit_log_admin_select ON public.audit_log;
CREATE POLICY audit_log_admin_select ON public.audit_log AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());

-- certificates
DROP POLICY IF EXISTS certificates_select_admin ON public.certificates;
CREATE POLICY certificates_select_admin ON public.certificates AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
DROP POLICY IF EXISTS certificates_select_owner ON public.certificates;
CREATE POLICY certificates_select_owner ON public.certificates AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = (( SELECT auth.uid() AS uid))::text));

-- checkout_locks
DROP POLICY IF EXISTS checkout_locks_service_access ON public.checkout_locks;
CREATE POLICY checkout_locks_service_access ON public.checkout_locks AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- community_comments
DROP POLICY IF EXISTS community_comments_delete_admin ON public.community_comments;
CREATE POLICY community_comments_delete_admin ON public.community_comments AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_comments_delete_author ON public.community_comments;
CREATE POLICY community_comments_delete_author ON public.community_comments AS PERMISSIVE FOR DELETE TO public
  USING ((author_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS community_comments_insert_enrolled ON public.community_comments;
CREATE POLICY community_comments_insert_enrolled ON public.community_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((author_id = (( SELECT auth.uid() AS uid))::text) AND has_enrollment_for_course_slug(course_slug) AND (EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_comments.post_id) AND (p.course_slug = community_comments.course_slug))))));
DROP POLICY IF EXISTS community_comments_select_admin ON public.community_comments;
CREATE POLICY community_comments_select_admin ON public.community_comments AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_comments_select_enrolled ON public.community_comments;
CREATE POLICY community_comments_select_enrolled ON public.community_comments AS PERMISSIVE FOR SELECT TO public
  USING (has_enrollment_for_course_slug(course_slug));
DROP POLICY IF EXISTS community_comments_update_admin ON public.community_comments;
CREATE POLICY community_comments_update_admin ON public.community_comments AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS community_comments_update_author ON public.community_comments;
CREATE POLICY community_comments_update_author ON public.community_comments AS PERMISSIVE FOR UPDATE TO public
  USING ((author_id = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((author_id = (( SELECT auth.uid() AS uid))::text));

-- community_post_likes
DROP POLICY IF EXISTS community_post_likes_delete_admin ON public.community_post_likes;
CREATE POLICY community_post_likes_delete_admin ON public.community_post_likes AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_post_likes_delete_owner ON public.community_post_likes;
CREATE POLICY community_post_likes_delete_owner ON public.community_post_likes AS PERMISSIVE FOR DELETE TO public
  USING ((liker_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS community_post_likes_insert_owner ON public.community_post_likes;
CREATE POLICY community_post_likes_insert_owner ON public.community_post_likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((liker_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_post_likes.post_id) AND has_enrollment_for_course_slug(p.course_slug))))));
DROP POLICY IF EXISTS community_post_likes_select_admin ON public.community_post_likes;
CREATE POLICY community_post_likes_select_admin ON public.community_post_likes AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_post_likes_select_enrolled ON public.community_post_likes;
CREATE POLICY community_post_likes_select_enrolled ON public.community_post_likes AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_post_likes.post_id) AND has_enrollment_for_course_slug(p.course_slug)))));

-- community_posts
DROP POLICY IF EXISTS community_posts_delete_admin ON public.community_posts;
CREATE POLICY community_posts_delete_admin ON public.community_posts AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_posts_delete_author ON public.community_posts;
CREATE POLICY community_posts_delete_author ON public.community_posts AS PERMISSIVE FOR DELETE TO public
  USING ((author_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS community_posts_insert_enrolled ON public.community_posts;
CREATE POLICY community_posts_insert_enrolled ON public.community_posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((author_id = (( SELECT auth.uid() AS uid))::text) AND has_enrollment_for_course_slug(course_slug) AND (COALESCE(pinned, false) = false) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE (((c.slug = community_posts.course_slug) OR (c.id = community_posts.course_slug)) AND c.community_enabled)))));
DROP POLICY IF EXISTS community_posts_select_enrolled ON public.community_posts;
CREATE POLICY community_posts_select_enrolled ON public.community_posts AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR has_enrollment_for_course_slug(course_slug)));
DROP POLICY IF EXISTS community_posts_update_admin ON public.community_posts;
CREATE POLICY community_posts_update_admin ON public.community_posts AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS community_posts_update_author ON public.community_posts;
CREATE POLICY community_posts_update_author ON public.community_posts AS PERMISSIVE FOR UPDATE TO public
  USING ((author_id = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((author_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS community_posts_update_course_teacher ON public.community_posts;
CREATE POLICY community_posts_update_course_teacher ON public.community_posts AS PERMISSIVE FOR UPDATE TO public
  USING ((is_teacher() AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.slug = community_posts.course_slug) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  WITH CHECK ((is_teacher() AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.slug = community_posts.course_slug) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

-- community_reports
DROP POLICY IF EXISTS community_reports_delete_admin ON public.community_reports;
CREATE POLICY community_reports_delete_admin ON public.community_reports AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS community_reports_insert_reporter ON public.community_reports;
CREATE POLICY community_reports_insert_reporter ON public.community_reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (reporter_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'open'::text) AND (post_id IS NOT NULL) AND (target_type IS NOT NULL) AND has_enrollment_for_course_slug(course_slug) AND (NOT is_target_author(target_type, post_id))));
DROP POLICY IF EXISTS community_reports_select_admin ON public.community_reports;
CREATE POLICY community_reports_select_admin ON public.community_reports AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR is_support() OR is_moderator()));
DROP POLICY IF EXISTS community_reports_select_reporter ON public.community_reports;
CREATE POLICY community_reports_select_reporter ON public.community_reports AS PERMISSIVE FOR SELECT TO public
  USING ((reporter_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS community_reports_update_trust ON public.community_reports;
CREATE POLICY community_reports_update_trust ON public.community_reports AS PERMISSIVE FOR UPDATE TO public
  USING ((is_support() OR is_moderator() OR is_admin()))
  WITH CHECK ((is_support() OR is_moderator() OR is_admin()));

-- course_assets
DROP POLICY IF EXISTS course_assets_delete_admin ON public.course_assets;
CREATE POLICY course_assets_delete_admin ON public.course_assets AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS course_assets_delete_owner ON public.course_assets;
CREATE POLICY course_assets_delete_owner ON public.course_assets AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));
DROP POLICY IF EXISTS course_assets_insert ON public.course_assets;
CREATE POLICY course_assets_insert ON public.course_assets AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text) AND (c.status = ANY (ARRAY['draft'::text, 'needs_changes'::text, 'published'::text, 'inactive'::text])))))));
DROP POLICY IF EXISTS course_assets_select ON public.course_assets;
CREATE POLICY course_assets_select ON public.course_assets AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_assets.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text) AND (e.status = ANY (ARRAY['active'::text, 'completed'::text])))))));
DROP POLICY IF EXISTS course_assets_update_admin ON public.course_assets;
CREATE POLICY course_assets_update_admin ON public.course_assets AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS course_assets_update_owner ON public.course_assets;
CREATE POLICY course_assets_update_owner ON public.course_assets AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));

-- course_commerce_settings
DROP POLICY IF EXISTS course_commerce_settings_owner_read ON public.course_commerce_settings;
CREATE POLICY course_commerce_settings_owner_read ON public.course_commerce_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (((owner_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

-- course_coupons
DROP POLICY IF EXISTS course_coupons_owner_read ON public.course_coupons;
CREATE POLICY course_coupons_owner_read ON public.course_coupons AS PERMISSIVE FOR SELECT TO authenticated
  USING (((owner_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

-- course_event_rsvps
DROP POLICY IF EXISTS course_event_rsvps_delete_admin ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_delete_admin ON public.course_event_rsvps AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS course_event_rsvps_delete_owner ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_delete_owner ON public.course_event_rsvps AS PERMISSIVE FOR DELETE TO public
  USING ((uid = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS course_event_rsvps_insert_owner ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_insert_owner ON public.course_event_rsvps AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)));
DROP POLICY IF EXISTS course_event_rsvps_select_admin ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_select_admin ON public.course_event_rsvps AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS course_event_rsvps_select_event_owner ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_select_event_owner ON public.course_event_rsvps AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.owner_id = (( SELECT auth.uid() AS uid))::text)))));
DROP POLICY IF EXISTS course_event_rsvps_select_owner ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_select_owner ON public.course_event_rsvps AS PERMISSIVE FOR SELECT TO public
  USING ((uid = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS course_event_rsvps_update_owner ON public.course_event_rsvps;
CREATE POLICY course_event_rsvps_update_owner ON public.course_event_rsvps AS PERMISSIVE FOR UPDATE TO public
  USING (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)))
  WITH CHECK (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)));

-- course_events
DROP POLICY IF EXISTS course_events_delete_admin ON public.course_events;
CREATE POLICY course_events_delete_admin ON public.course_events AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS course_events_delete_teacher ON public.course_events;
CREATE POLICY course_events_delete_teacher ON public.course_events AS PERMISSIVE FOR DELETE TO public
  USING ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text)));
DROP POLICY IF EXISTS course_events_insert_admin ON public.course_events;
CREATE POLICY course_events_insert_admin ON public.course_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS course_events_insert_teacher ON public.course_events;
CREATE POLICY course_events_insert_teacher ON public.course_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'scheduled'::text) AND (recording_asset_id IS NULL) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));
DROP POLICY IF EXISTS course_events_select_admin ON public.course_events;
CREATE POLICY course_events_select_admin ON public.course_events AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS course_events_select_enrolled ON public.course_events;
CREATE POLICY course_events_select_enrolled ON public.course_events AS PERMISSIVE FOR SELECT TO public
  USING (has_enrollment_for_course_slug(course_slug));
DROP POLICY IF EXISTS course_events_select_owner ON public.course_events;
CREATE POLICY course_events_select_owner ON public.course_events AS PERMISSIVE FOR SELECT TO public
  USING ((owner_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS course_events_update_admin ON public.course_events;
CREATE POLICY course_events_update_admin ON public.course_events AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS course_events_update_teacher ON public.course_events;
CREATE POLICY course_events_update_teacher ON public.course_events AS PERMISSIVE FOR UPDATE TO public
  USING ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  WITH CHECK ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

-- course_lesson_content
DROP POLICY IF EXISTS course_lesson_content_delete ON public.course_lesson_content;
CREATE POLICY course_lesson_content_delete ON public.course_lesson_content AS PERMISSIVE FOR DELETE TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));
DROP POLICY IF EXISTS course_lesson_content_insert_owner ON public.course_lesson_content;
CREATE POLICY course_lesson_content_insert_owner ON public.course_lesson_content AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));
DROP POLICY IF EXISTS course_lesson_content_select ON public.course_lesson_content;
CREATE POLICY course_lesson_content_select ON public.course_lesson_content AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_lesson_content.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));
DROP POLICY IF EXISTS course_lesson_content_update_owner ON public.course_lesson_content;
CREATE POLICY course_lesson_content_update_owner ON public.course_lesson_content AS PERMISSIVE FOR UPDATE TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  WITH CHECK ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

-- course_messages
DROP POLICY IF EXISTS course_messages_select ON public.course_messages;
CREATE POLICY course_messages_select ON public.course_messages AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (student_id = (( SELECT auth.uid() AS uid))::text) OR (teacher_id = (( SELECT auth.uid() AS uid))::text)));

-- course_reviews
DROP POLICY IF EXISTS course_reviews_select ON public.course_reviews;
CREATE POLICY course_reviews_select ON public.course_reviews AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_reviews.course_id) AND (c.status = ANY (ARRAY['published'::text, 'in_review'::text]))))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((id = ((course_id || '__'::text) || (( SELECT auth.uid() AS uid))::text)) OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_reviews.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_reviews.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))))));

-- course_subscriptions
DROP POLICY IF EXISTS course_subscriptions_owner_sel ON public.course_subscriptions;
CREATE POLICY course_subscriptions_owner_sel ON public.course_subscriptions AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));
DROP POLICY IF EXISTS course_subscriptions_teacher_read ON public.course_subscriptions;
CREATE POLICY course_subscriptions_teacher_read ON public.course_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((teacher_id = (( SELECT auth.uid() AS uid))::text));

-- courses
DROP POLICY IF EXISTS courses_delete_admin ON public.courses;
CREATE POLICY courses_delete_admin ON public.courses AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS courses_delete_owner ON public.courses;
CREATE POLICY courses_delete_owner ON public.courses AS PERMISSIVE FOR DELETE TO public
  USING (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = ANY (ARRAY['draft'::text, 'needs_changes'::text, 'inactive'::text]))));
DROP POLICY IF EXISTS courses_insert_owner ON public.courses;
CREATE POLICY courses_insert_owner ON public.courses AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'draft'::text) AND is_teacher() AND (is_admin() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.uid = (( SELECT auth.uid() AS uid))::text) AND (u.teacher_terms_accepted_at IS NOT NULL) AND (u.teacher_terms_version IS NOT NULL)))))));
DROP POLICY IF EXISTS courses_select_admin ON public.courses;
CREATE POLICY courses_select_admin ON public.courses AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS courses_select_enrolled ON public.courses;
CREATE POLICY courses_select_enrolled ON public.courses AS PERMISSIVE FOR SELECT TO public
  USING (has_enrollment_for_course_slug(slug));
DROP POLICY IF EXISTS courses_select_owner ON public.courses;
CREATE POLICY courses_select_owner ON public.courses AS PERMISSIVE FOR SELECT TO public
  USING ((owner_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS courses_select_public ON public.courses;
CREATE POLICY courses_select_public ON public.courses AS PERMISSIVE FOR SELECT TO public
  USING ((status = ANY (ARRAY['published'::text, 'in_review'::text])));
DROP POLICY IF EXISTS courses_update_admin ON public.courses;
CREATE POLICY courses_update_admin ON public.courses AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS courses_update_ops ON public.courses;
CREATE POLICY courses_update_ops ON public.courses AS PERMISSIVE FOR UPDATE TO public
  USING (is_ops())
  WITH CHECK (is_ops());
DROP POLICY IF EXISTS courses_update_owner ON public.courses;
CREATE POLICY courses_update_owner ON public.courses AS PERMISSIVE FOR UPDATE TO public
  USING ((owner_id = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((owner_id = (( SELECT auth.uid() AS uid))::text));

-- creator_verification_cases
DROP POLICY IF EXISTS creator_verification_cases_owner_read ON public.creator_verification_cases;
CREATE POLICY creator_verification_cases_owner_read ON public.creator_verification_cases AS PERMISSIVE FOR SELECT TO authenticated
  USING (((creator_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

-- enrollments
DROP POLICY IF EXISTS enrollments_delete_admin ON public.enrollments;
CREATE POLICY enrollments_delete_admin ON public.enrollments AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS enrollments_insert_admin ON public.enrollments;
CREATE POLICY enrollments_insert_admin ON public.enrollments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS enrollments_select_admin ON public.enrollments;
CREATE POLICY enrollments_select_admin ON public.enrollments AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS enrollments_select_owner ON public.enrollments;
CREATE POLICY enrollments_select_owner ON public.enrollments AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS enrollments_update_admin ON public.enrollments;
CREATE POLICY enrollments_update_admin ON public.enrollments AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS enrollments_update_owner ON public.enrollments;
CREATE POLICY enrollments_update_owner ON public.enrollments AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

-- leaderboards
DROP POLICY IF EXISTS leaderboards_select_authenticated ON public.leaderboards;
CREATE POLICY leaderboards_select_authenticated ON public.leaderboards AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- learning_path_items
DROP POLICY IF EXISTS learning_path_items_admin_delete ON public.learning_path_items;
CREATE POLICY learning_path_items_admin_delete ON public.learning_path_items AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS learning_path_items_admin_insert ON public.learning_path_items;
CREATE POLICY learning_path_items_admin_insert ON public.learning_path_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_admin());
-- NOTE: production has USING but no WITH CHECK on this UPDATE policy.
-- Reproduced verbatim. Postgres then reuses USING as the check expression.
DROP POLICY IF EXISTS learning_path_items_admin_update ON public.learning_path_items;
CREATE POLICY learning_path_items_admin_update ON public.learning_path_items AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin());
DROP POLICY IF EXISTS learning_path_items_select ON public.learning_path_items;
CREATE POLICY learning_path_items_select ON public.learning_path_items AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM learning_paths p
  WHERE ((p.id = learning_path_items.path_id) AND (p.status = 'published'::text))))));

-- learning_paths
DROP POLICY IF EXISTS learning_paths_admin_delete ON public.learning_paths;
CREATE POLICY learning_paths_admin_delete ON public.learning_paths AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS learning_paths_admin_insert ON public.learning_paths;
CREATE POLICY learning_paths_admin_insert ON public.learning_paths AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_admin());
-- NOTE: production has USING but no WITH CHECK on this UPDATE policy.
-- Reproduced verbatim. Postgres then reuses USING as the check expression.
DROP POLICY IF EXISTS learning_paths_admin_update ON public.learning_paths;
CREATE POLICY learning_paths_admin_update ON public.learning_paths AS PERMISSIVE FOR UPDATE TO public
  USING (is_admin());
DROP POLICY IF EXISTS learning_paths_select ON public.learning_paths;
CREATE POLICY learning_paths_select ON public.learning_paths AS PERMISSIVE FOR SELECT TO public
  USING (((status = 'published'::text) OR is_admin()));

-- lesson_comments
DROP POLICY IF EXISTS lesson_comments_delete ON public.lesson_comments;
CREATE POLICY lesson_comments_delete ON public.lesson_comments AS PERMISSIVE FOR DELETE TO public
  USING ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)));
DROP POLICY IF EXISTS lesson_comments_insert ON public.lesson_comments;
CREATE POLICY lesson_comments_insert ON public.lesson_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (author_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = lesson_comments.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));
DROP POLICY IF EXISTS lesson_comments_select ON public.lesson_comments;
CREATE POLICY lesson_comments_select ON public.lesson_comments AS PERMISSIVE FOR SELECT TO public
  USING ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = lesson_comments.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = lesson_comments.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));
DROP POLICY IF EXISTS lesson_comments_update ON public.lesson_comments;
CREATE POLICY lesson_comments_update ON public.lesson_comments AS PERMISSIVE FOR UPDATE TO public
  USING ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)))
  WITH CHECK ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)));

-- lesson_progress
DROP POLICY IF EXISTS lesson_progress_select_admin ON public.lesson_progress;
CREATE POLICY lesson_progress_select_admin ON public.lesson_progress AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS lesson_progress_select_owner ON public.lesson_progress;
CREATE POLICY lesson_progress_select_owner ON public.lesson_progress AS PERMISSIVE FOR SELECT TO public
  USING ((enrollment_id IN ( SELECT e.id
   FROM enrollments e
  WHERE (e.user_id = (( SELECT auth.uid() AS uid))::text))));

-- member_stats
DROP POLICY IF EXISTS member_stats_select_authenticated ON public.member_stats;
CREATE POLICY member_stats_select_authenticated ON public.member_stats AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- notifications
DROP POLICY IF EXISTS notifications_select_owner ON public.notifications;
CREATE POLICY notifications_select_owner ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));
DROP POLICY IF EXISTS notifications_update_owner ON public.notifications;
CREATE POLICY notifications_update_owner ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

-- orders
DROP POLICY IF EXISTS orders_owner_sel ON public.orders;
CREATE POLICY orders_owner_sel ON public.orders AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));
DROP POLICY IF EXISTS orders_teacher_read ON public.orders;
CREATE POLICY orders_teacher_read ON public.orders AS PERMISSIVE FOR SELECT TO authenticated
  USING ((teacher_id = (( SELECT auth.uid() AS uid))::text));

-- payments
DROP POLICY IF EXISTS payments_owner_sel ON public.payments;
CREATE POLICY payments_owner_sel ON public.payments AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

-- payout_ledger
DROP POLICY IF EXISTS payout_ledger_owner_sel ON public.payout_ledger;
CREATE POLICY payout_ledger_owner_sel ON public.payout_ledger AS PERMISSIVE FOR SELECT TO public
  USING (((teacher_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));
DROP POLICY IF EXISTS payout_ledger_service_write ON public.payout_ledger;
CREATE POLICY payout_ledger_service_write ON public.payout_ledger AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS payout_ledger_teacher_read ON public.payout_ledger;
CREATE POLICY payout_ledger_teacher_read ON public.payout_ledger AS PERMISSIVE FOR SELECT TO authenticated
  USING ((teacher_id = (( SELECT auth.uid() AS uid))::text));

-- platform_settings
DROP POLICY IF EXISTS platform_settings_read ON public.platform_settings;
CREATE POLICY platform_settings_read ON public.platform_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- points_events
DROP POLICY IF EXISTS points_events_select_admin ON public.points_events;
CREATE POLICY points_events_select_admin ON public.points_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());

-- product_offers
DROP POLICY IF EXISTS product_offers_public_read ON public.product_offers;
CREATE POLICY product_offers_public_read ON public.product_offers AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((active = true));

-- product_prices
DROP POLICY IF EXISTS product_prices_public_read ON public.product_prices;
CREATE POLICY product_prices_public_read ON public.product_prices AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING ((active = true));

-- public_profiles
DROP POLICY IF EXISTS public_profiles_select_public ON public.public_profiles;
CREATE POLICY public_profiles_select_public ON public.public_profiles AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);

-- rate_limits
DROP POLICY IF EXISTS rate_limits_service_access ON public.rate_limits;
CREATE POLICY rate_limits_service_access ON public.rate_limits AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- support_tickets
DROP POLICY IF EXISTS support_tickets_delete_admin ON public.support_tickets;
CREATE POLICY support_tickets_delete_admin ON public.support_tickets AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS support_tickets_insert_owner ON public.support_tickets;
CREATE POLICY support_tickets_insert_owner ON public.support_tickets AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'open'::text) AND (admin_response IS NULL) AND (responded_by IS NULL) AND (responded_at IS NULL)));
DROP POLICY IF EXISTS support_tickets_select_owner ON public.support_tickets;
CREATE POLICY support_tickets_select_owner ON public.support_tickets AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS support_tickets_select_support ON public.support_tickets;
CREATE POLICY support_tickets_select_support ON public.support_tickets AS PERMISSIVE FOR SELECT TO public
  USING (is_support());
DROP POLICY IF EXISTS support_tickets_update_support ON public.support_tickets;
CREATE POLICY support_tickets_update_support ON public.support_tickets AS PERMISSIVE FOR UPDATE TO public
  USING (is_support())
  WITH CHECK (is_support());

-- users
DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((uid = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS users_select_admin ON public.users;
CREATE POLICY users_select_admin ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((uid = (( SELECT auth.uid() AS uid))::text));
DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING ((uid = (( SELECT auth.uid() AS uid))::text))
  WITH CHECK ((uid = (( SELECT auth.uid() AS uid))::text));

-- wishlists
DROP POLICY IF EXISTS wishlists_delete_admin ON public.wishlists;
CREATE POLICY wishlists_delete_admin ON public.wishlists AS PERMISSIVE FOR DELETE TO public
  USING (is_admin());
DROP POLICY IF EXISTS wishlists_delete_owner ON public.wishlists;
CREATE POLICY wishlists_delete_owner ON public.wishlists AS PERMISSIVE FOR DELETE TO public
  USING (((( SELECT auth.uid() AS uid))::text = user_id));
DROP POLICY IF EXISTS wishlists_insert_owner ON public.wishlists;
CREATE POLICY wishlists_insert_owner ON public.wishlists AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid))::text = user_id) AND (id = ((user_id || '__'::text) || course_id))));
DROP POLICY IF EXISTS wishlists_select_admin ON public.wishlists;
CREATE POLICY wishlists_select_admin ON public.wishlists AS PERMISSIVE FOR SELECT TO public
  USING (is_admin());
DROP POLICY IF EXISTS wishlists_select_owner ON public.wishlists;
CREATE POLICY wishlists_select_owner ON public.wishlists AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid))::text = user_id));


-- =============================================================================
-- SECTION 3 -- NON-DEFAULT TABLE GRANTS (9 tables)
-- =============================================================================
-- The other 38 public tables carry Supabase's default grant set
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER to anon,
-- authenticated and service_role) and are therefore not restated here.
--
-- These 9 have had grants deliberately revoked in production. Grants are a
-- second, independent gate: RLS decides which ROWS are visible, grants decide
-- whether the role may touch the table at all. A fresh environment that only
-- replayed the policies above would still be more permissive than production,
-- so the revokes are part of the snapshot.

-- Money / read-only-to-clients tables: writes go through service_role only.
REVOKE INSERT, UPDATE, DELETE ON public.course_subscriptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.public_profiles FROM anon, authenticated;

-- payout_ledger: authenticated may read only; anon has nothing at all.
REVOKE ALL ON public.payout_ledger FROM anon, authenticated;
GRANT SELECT ON public.payout_ledger TO authenticated;

-- Server-side-only tables: no client role has any grant.
REVOKE ALL ON public.checkout_locks FROM anon, authenticated;
REVOKE ALL ON public.processed_stripe_events FROM anon, authenticated;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;

-- service_role retains the full default grant set on every table above.

-- =============================================================================
-- END OF SNAPSHOT
-- =============================================================================

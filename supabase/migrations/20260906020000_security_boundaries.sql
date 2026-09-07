-- Direct PostgREST/Storage calls must enforce the same MFA boundary as the app.
-- Keep public reads public, preserve service-role jobs, and never mask auth.uid().
CREATE FUNCTION public.require_strong_session() RETURNS void
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.session_is_strong() AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Complete the second authentication factor.' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_strong_session() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.require_strong_session() TO service_role;

-- These are the existing private read/write RPCs, including the legacy overload.
-- Reuse their identity/ownership checks. Only inject the MFA check; signatures,
-- privileges, business rules, and caller identity remain unchanged.
DO $$
DECLARE f record; next_body text; names text[] := ARRAY[
 'admin_list_platform_users','admin_set_user_roles','claim_custom_domain',
 'create_course_coupon','create_free_course_enrollment','create_teacher_course_draft',
 'delete_course_as_admin','delete_course_coupon','delete_teacher_course_draft',
 'issue_skillset_certificate','publish_teacher_course','record_lesson_playback',
 'record_lesson_progress','release_own_custom_domain','request_account_action',
 'review_creator_verification','save_own_course_landing','send_course_message',
 'set_course_coupon_active','set_own_course_featured','submit_course_review',
 'submit_creator_verification','submit_teacher_course_for_review',
 'update_teacher_course_builder','upsert_course_commerce_settings'
]; covered text[] := '{}';
BEGIN
  FOR f IN SELECT p.oid,p.proname,p.prosrc,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname=ANY(names) AND p.prosecdef AND l.lanname='plpgsql'
  LOOP
    next_body := regexp_replace(f.prosrc,'(^|\n)([[:space:]]*)begin([[:space:]]|$)',
      E'\\1\\2BEGIN\n  PERFORM public.require_strong_session();\\3','i');
    IF next_body=f.prosrc OR position(f.prosrc IN f.definition)=0 THEN
      RAISE EXCEPTION 'MFA guard could not be applied to %',f.oid::regprocedure;
    END IF;
    EXECUTE replace(f.definition,f.prosrc,next_body);
    covered := array_append(covered,f.proname);
  END LOOP;
  IF NOT names <@ covered THEN RAISE EXCEPTION 'Missing RPC in MFA guard coverage'; END IF;
END $$;

-- SQL read RPCs bypass RLS too. Empty results for a pending second factor;
-- these signatures and projections match the existing callers exactly.
CREATE OR REPLACE FUNCTION public.get_my_course_students()
RETURNS TABLE(enrollment_id text,course_id text,course_title text,uid text,display_name text,email text,photo_url text,status text,source text,progress_percent integer,enrolled_at timestamptz,last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT e.id,e.course_id,e.course_title,u.uid,u.display_name,u.email,u.photo_url,e.status,e.source,e.progress_percent,e.created_at,
   (SELECT max(p.last_seen_at) FROM public.lesson_playback p WHERE p.enrollment_id=e.id)
 FROM public.enrollments e JOIN public.courses c ON c.id=e.course_id LEFT JOIN public.users u ON u.uid=e.user_id
 WHERE c.owner_id=(SELECT auth.uid())::text AND (SELECT public.session_is_strong())
 ORDER BY e.created_at DESC;
$$;
CREATE OR REPLACE FUNCTION public.get_my_course_lesson_funnel()
RETURNS TABLE(course_id text,lesson_id text,students_opened integer,students_completed integer,last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT e.course_id,p.lesson_id,count(*)::integer,count(*) FILTER(WHERE lp.lesson_id IS NOT NULL)::integer,max(p.last_seen_at)
 FROM public.lesson_playback p JOIN public.enrollments e ON e.id=p.enrollment_id JOIN public.courses c ON c.id=e.course_id
 LEFT JOIN public.lesson_progress lp ON lp.enrollment_id=p.enrollment_id AND lp.lesson_id=p.lesson_id
 WHERE c.owner_id=(SELECT auth.uid())::text AND (SELECT public.session_is_strong())
 GROUP BY e.course_id,p.lesson_id;
$$;
CREATE OR REPLACE FUNCTION public.get_my_subscriber_profiles()
RETURNS TABLE(uid text,display_name text,photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT u.uid,u.display_name,u.photo_url FROM public.users u
 WHERE (SELECT public.session_is_strong()) AND u.uid IN (
   SELECT cs.user_id FROM public.course_subscriptions cs WHERE cs.teacher_id=(SELECT auth.uid())::text
   UNION SELECT o.user_id FROM public.orders o WHERE o.teacher_id=(SELECT auth.uid())::text
 );
$$;
CREATE OR REPLACE FUNCTION public.get_my_custom_domain_quota()
RETURNS TABLE(used integer,"limit" integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT (SELECT count(*)::integer FROM public.custom_domains d WHERE d.owner_uid=(SELECT auth.uid())::text),
   public.custom_domain_limit_for_plan((SELECT u.current_plan_id FROM public.users u WHERE u.uid=(SELECT auth.uid())::text))
 WHERE (SELECT public.session_is_strong());
$$;

-- Private lesson content already has its own table and authorized reader.
-- The builder's local v_modules still contains the submitted text and writes
-- that table after updating courses. Strip only the public stored copy.
CREATE FUNCTION public.course_public_curriculum(p_modules jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_set(m.value,'{lessons}',
   coalesce((SELECT jsonb_agg(l.value-ARRAY['contentText','externalUrl'] ORDER BY l.ordinality)
     FROM jsonb_array_elements(coalesce(m.value->'lessons','[]')) WITH ORDINALITY l), '[]'))
   ORDER BY m.ordinality),'[]')
 FROM jsonb_array_elements(p_modules) WITH ORDINALITY m;
$$;
CREATE FUNCTION public.protect_public_course_curriculum() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN NEW.modules:=public.course_public_curriculum(NEW.modules); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.course_public_curriculum(jsonb),public.protect_public_course_curriculum() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_public_curriculum(jsonb) TO authenticated,service_role;
CREATE TRIGGER courses_public_curriculum_biu BEFORE INSERT OR UPDATE OF modules ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.protect_public_course_curriculum();

-- Preserve legacy inline-only text before removing it. Existing authoritative
-- content wins. Hold both sources stable until backfill and stripping finish;
-- a concurrent private INSERT cannot change the checked destination.
LOCK TABLE public.courses,public.course_lesson_content IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.courses c, jsonb_array_elements(c.modules) m,jsonb_array_elements(coalesce(m->'lessons','[]')) l
   WHERE (l ? 'contentText' OR l ? 'externalUrl')
     AND (jsonb_typeof(l->'id') IS DISTINCT FROM 'string' OR l->>'id' ~ '^[[:space:]]*$')) THEN
   RAISE EXCEPTION 'Unsafe lesson backfill: private inline content requires a nonblank string lesson ID';
 END IF;
 -- Count every occurrence, including another public-only reference or two
 -- lessons in one course. ON CONFLICT must not choose which source survives.
 IF EXISTS(SELECT l->>'id' FROM public.courses c, jsonb_array_elements(c.modules) m,jsonb_array_elements(coalesce(m->'lessons','[]')) l
   GROUP BY l->>'id' HAVING count(*)>1 AND bool_or(l ? 'contentText' OR l ? 'externalUrl')) THEN
   RAISE EXCEPTION 'Unsafe lesson backfill: an inline lesson ID has multiple curriculum references';
 END IF;
 IF EXISTS(SELECT FROM public.courses c, jsonb_array_elements(c.modules) m,jsonb_array_elements(coalesce(m->'lessons','[]')) l
   JOIN public.course_lesson_content lc ON lc.lesson_id=l->>'id'
   WHERE (l ? 'contentText' OR l ? 'externalUrl') AND lc.course_id<>c.id) THEN
   RAISE EXCEPTION 'Lesson ownership conflict: resolve before stripping public content';
 END IF;
END $$;
INSERT INTO public.course_lesson_content(lesson_id,course_id,content_text,external_url,created_at,updated_at)
SELECT l->>'id',c.id,nullif(l->>'contentText',''),nullif(l->>'externalUrl',''),now(),now()
FROM public.courses c,jsonb_array_elements(c.modules) m,jsonb_array_elements(coalesce(m->'lessons','[]')) l
WHERE nullif(l->>'id','') IS NOT NULL AND (l ? 'contentText' OR l ? 'externalUrl')
ON CONFLICT(lesson_id) DO NOTHING;
UPDATE public.courses SET modules=public.course_public_curriculum(modules)
WHERE modules IS DISTINCT FROM public.course_public_curriculum(modules);

-- The intentionally selected preview remains public; every other lesson keeps
-- its existing owner/admin/enrollment requirement.
CREATE POLICY course_lesson_content_select_free_preview ON public.course_lesson_content FOR SELECT
USING(EXISTS(SELECT FROM public.courses c WHERE c.id=course_id AND c.status='published' AND c.free_preview_lesson_id=lesson_id));

-- Restrictive policies combine with AND, including when an admin/ops permissive
-- branch succeeds. The public-read expression is explicit for each public table.
DO $policies$ DECLARE t record; public_read text; BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
     AND EXISTS(SELECT FROM pg_policy p WHERE p.polrelid=c.oid)
 LOOP
   public_read:=CASE t.relname
     WHEN 'courses' THEN $$status IN ('published','in_review')$$
     WHEN 'course_landings' THEN $$EXISTS(SELECT FROM public.courses c WHERE c.id=course_id AND c.status IN ('published','in_review'))$$
     WHEN 'course_reviews' THEN $$EXISTS(SELECT FROM public.courses c WHERE c.id=course_id AND c.status IN ('published','in_review'))$$
     WHEN 'course_lesson_content' THEN $$EXISTS(SELECT FROM public.courses c WHERE c.id=course_id AND c.status='published' AND c.free_preview_lesson_id=lesson_id)$$
     WHEN 'learning_paths' THEN $$status='published'$$
     WHEN 'learning_path_items' THEN $$EXISTS(SELECT FROM public.learning_paths p WHERE p.id=path_id AND p.status='published')$$
     WHEN 'product_offers' THEN 'active=true'
     WHEN 'product_prices' THEN 'active=true'
     WHEN 'public_profiles' THEN 'true'
     WHEN 'public_domains' THEN 'true'
     ELSE NULL END;
   IF public_read IS NULL THEN
     EXECUTE format('CREATE POLICY strong_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING((SELECT public.session_is_strong())) WITH CHECK((SELECT public.session_is_strong()))',t.relname);
   ELSE
     EXECUTE format('CREATE POLICY strong_session_private_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING((SELECT public.session_is_strong()) OR (%s))',t.relname,public_read);
     EXECUTE format('CREATE POLICY strong_session_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK((SELECT public.session_is_strong()))',t.relname);
     EXECUTE format('CREATE POLICY strong_session_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING((SELECT public.session_is_strong())) WITH CHECK((SELECT public.session_is_strong()))',t.relname);
     EXECUTE format('CREATE POLICY strong_session_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING((SELECT public.session_is_strong()))',t.relname);
   END IF;
 END LOOP;
END $policies$;
CREATE POLICY strong_session_required ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING((SELECT public.session_is_strong())) WITH CHECK((SELECT public.session_is_strong()));

-- Stripe identifiers are server-owned at INSERT as well as UPDATE. Neither an
-- admin session nor the generic trusted-write flag is a Stripe authority.
CREATE FUNCTION public.protect_course_stripe_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF public.is_service_role() THEN RETURN NEW; END IF;
 IF (TG_OP='INSERT' AND (NEW.stripe_connected_account_id IS NOT NULL OR NEW.stripe_subscription_price IS NOT NULL))
 OR (TG_OP='UPDATE' AND (NEW.stripe_connected_account_id IS DISTINCT FROM OLD.stripe_connected_account_id
    OR NEW.stripe_subscription_price IS DISTINCT FROM OLD.stripe_subscription_price)) THEN
   RAISE EXCEPTION 'Course Stripe fields are server-controlled.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_course_stripe_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER courses_stripe_fields_biu BEFORE INSERT OR UPDATE ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.protect_course_stripe_fields();

-- IDs and slugs occupy different namespaces. Always resolve the canonical ID
-- first, so a creator's slug cannot impersonate another course's identity.
CREATE FUNCTION public.resolve_course_reference(p_reference text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT id FROM public.courses WHERE id=p_reference),(SELECT id FROM public.courses WHERE slug=p_reference));
$$;
REVOKE ALL ON FUNCTION public.resolve_course_reference(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.owns_course_reference(p_reference text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_teacher() AND public.session_is_strong() AND EXISTS(
   SELECT FROM public.courses WHERE id=public.resolve_course_reference(p_reference) AND owner_id=(SELECT auth.uid())::text
 );
$$;
REVOKE ALL ON FUNCTION public.owns_course_reference(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_course_reference(text) TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.has_enrollment_for_course_slug(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
 SELECT public.session_is_strong() AND EXISTS(
   SELECT FROM public.enrollments e WHERE e.user_id=(SELECT auth.uid())::text
     AND e.status IN ('active','completed') AND e.course_id=public.resolve_course_reference(p_slug)
 );
$function$;
ALTER POLICY courses_select_enrolled ON public.courses USING(public.has_enrollment_for_course_slug(id));
ALTER POLICY community_posts_select_course_teacher ON public.community_posts USING(public.owns_course_reference(course_slug));
ALTER POLICY community_comments_select_course_teacher ON public.community_comments USING(public.owns_course_reference(course_slug));
ALTER POLICY community_post_likes_select_course_teacher ON public.community_post_likes
USING(EXISTS(SELECT FROM public.community_posts p WHERE p.id=post_id AND public.owns_course_reference(p.course_slug)));
ALTER POLICY community_comments_insert_course_teacher ON public.community_comments
WITH CHECK(author_id=(SELECT auth.uid())::text AND public.owns_course_reference(course_slug)
  AND EXISTS(SELECT FROM public.community_posts p WHERE p.id=post_id AND p.course_slug=community_comments.course_slug));
ALTER POLICY community_posts_update_course_teacher ON public.community_posts
USING(public.owns_course_reference(course_slug)) WITH CHECK(public.owns_course_reference(course_slug));
CREATE OR REPLACE FUNCTION public.community_posts_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_is_course_teacher boolean;
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN RETURN NEW; END IF;
  v_is_course_teacher:=public.owns_course_reference(OLD.course_slug);

  -- A teacher moderating somebody else's post keeps the existing field guard.
  -- When also the author, retain both author edits and the moderation right.
  IF v_is_course_teacher AND OLD.author_id IS DISTINCT FROM (SELECT auth.uid())::text THEN
    IF (NEW.course_slug IS DISTINCT FROM OLD.course_slug
        AND NEW.course_slug IS DISTINCT FROM public.resolve_course_reference(OLD.course_slug))
       OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.author_name IS DISTINCT FROM OLD.author_name
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'community_posts: course-owning teacher may only change pinned/updated_at';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.course_slug IS DISTINCT FROM OLD.course_slug
      AND NEW.course_slug IS DISTINCT FROM public.resolve_course_reference(OLD.course_slug))
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NOT v_is_course_teacher AND coalesce(NEW.pinned,false) IS DISTINCT FROM coalesce(OLD.pinned,false)) THEN
    RAISE EXCEPTION 'community_posts: author may only edit body/updated_at and may not self-pin';
  END IF;
  RETURN NEW;
END $$;

-- The feed renders this label and uses teacher/admin in its instructor filter.
-- Keep the client's existing roles[0] rule, but derive it from the protected
-- profile. This trigger runs before the existing field guards on both tables.
CREATE FUNCTION public.set_community_author_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  SELECT coalesce(u.roles->>0,'student') INTO NEW.author_role
  FROM public.users u WHERE u.uid=NEW.author_id;
  NEW.author_role:=coalesce(NEW.author_role,'student');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_community_author_role() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER community_author_role_biu BEFORE INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.set_community_author_role();
CREATE TRIGGER community_author_role_biu BEFORE INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.set_community_author_role();

CREATE OR REPLACE FUNCTION public.community_comments_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN RETURN NEW; END IF;
  -- author_role is already derived by community_author_role_biu. Do not reject
  -- a legitimate body edit when the author's current role changes the label.
  IF NEW.author_id IS DISTINCT FROM OLD.author_id
     OR (NEW.course_slug IS DISTINCT FROM OLD.course_slug
         AND NEW.course_slug IS DISTINCT FROM public.resolve_course_reference(OLD.course_slug))
     OR NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'community_comments: only body may be edited';
  END IF;
  RETURN NEW;
END $$;

UPDATE public.community_posts p SET author_role=coalesce((SELECT u.roles->>0 FROM public.users u WHERE u.uid=p.author_id),'student')
WHERE p.author_role IS DISTINCT FROM coalesce((SELECT u.roles->>0 FROM public.users u WHERE u.uid=p.author_id),'student');
UPDATE public.community_comments c SET author_role=coalesce((SELECT u.roles->>0 FROM public.users u WHERE u.uid=c.author_id),'student')
WHERE c.author_role IS DISTINCT FROM coalesce((SELECT u.roles->>0 FROM public.users u WHERE u.uid=c.author_id),'student');

-- A slug can be renamed and reused. Store the course ID in community rows;
-- current app callers already use IDs. Check historical data before deciding
-- what a text reference meant, and prevent concurrent renames during upgrade.
LOCK TABLE public.courses,public.community_posts,public.community_comments,
  public.community_reports,public.course_events IN SHARE ROW EXCLUSIVE MODE;
DO $$ DECLARE orphans bigint; ambiguous bigint; inconsistent bigint; orphan_events bigint;
BEGIN
  WITH refs AS (
    SELECT course_slug AS ref FROM public.community_posts
    UNION SELECT course_slug FROM public.community_comments
    UNION SELECT course_slug FROM public.community_reports
  ), matches AS (
    SELECT refs.ref,count(DISTINCT c.id) AS n FROM refs
    LEFT JOIN public.courses c ON c.id=refs.ref OR c.slug=refs.ref GROUP BY refs.ref
  ) SELECT count(*) FILTER(WHERE n=0),count(*) FILTER(WHERE n>1)
    INTO orphans,ambiguous FROM matches;
  SELECT count(*) INTO inconsistent FROM (
    SELECT c.course_slug,p.course_slug AS post_course FROM public.community_comments c
      LEFT JOIN public.community_posts p ON p.id=c.post_id
    UNION ALL
    SELECT r.course_slug,p.course_slug FROM public.community_reports r
      LEFT JOIN public.community_posts p ON p.id=r.post_id
  ) refs WHERE post_course IS NULL
    OR public.resolve_course_reference(course_slug) IS DISTINCT FROM public.resolve_course_reference(post_course);
  SELECT count(*) INTO orphan_events FROM public.course_events ev
    LEFT JOIN public.courses c ON c.id=ev.course_id WHERE c.id IS NULL;
  IF orphans+ambiguous+inconsistent+orphan_events>0 THEN
    RAISE EXCEPTION 'Course reference preflight failed: % orphan references, % ambiguous references, % inconsistent post links, % orphan events',
      orphans,ambiguous,inconsistent,orphan_events
      USING HINT='Resolve these records explicitly before retrying; this migration does not delete or guess their course.';
  END IF;
END $$;

CREATE FUNCTION public.canonicalize_community_course_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_course_id text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.course_slug IS NOT DISTINCT FROM OLD.course_slug THEN
    IF TG_TABLE_NAME='community_posts' THEN RETURN NEW;
    ELSIF NEW.post_id IS NOT DISTINCT FROM OLD.post_id THEN RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME='community_posts' THEN
    v_course_id:=public.resolve_course_reference(NEW.course_slug);
  ELSE
    -- A comment/report takes its authority from the post, never the label
    -- supplied by its caller. Existing immutable-field guards still apply.
    SELECT p.course_slug INTO v_course_id FROM public.community_posts p WHERE p.id=NEW.post_id;
  END IF;
  IF v_course_id IS NULL THEN
    RAISE EXCEPTION 'An existing course and post are required.' USING ERRCODE='42501';
  END IF;
  NEW.course_slug:=v_course_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.canonicalize_community_course_reference() FROM PUBLIC,anon,authenticated;
-- "00" ensures normalization runs before the existing immutable-field guards.
CREATE TRIGGER community_00_course_reference_biu BEFORE INSERT OR UPDATE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_community_course_reference();
CREATE TRIGGER community_00_course_reference_biu BEFORE INSERT OR UPDATE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_community_course_reference();
CREATE TRIGGER community_00_course_reference_biu BEFORE INSERT OR UPDATE ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_community_course_reference();

CREATE OR REPLACE FUNCTION public.community_reports_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_service_role() THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR (NEW.course_slug IS DISTINCT FROM OLD.course_slug
         AND NEW.course_slug IS DISTINCT FROM public.resolve_course_reference(OLD.course_slug))
     OR NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_author_id IS DISTINCT FROM OLD.target_author_id
     OR NEW.target_author_name IS DISTINCT FROM OLD.target_author_name
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.reporter_name IS DISTINCT FROM OLD.reporter_name
     OR NEW.reporter_email IS DISTINCT FROM OLD.reporter_email
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.detail IS DISTINCT FROM OLD.detail
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'community_reports: only status and updated_at may change';
  END IF;
  RETURN NEW;
END $$;

UPDATE public.community_posts p SET course_slug=public.resolve_course_reference(p.course_slug)
WHERE p.course_slug IS DISTINCT FROM public.resolve_course_reference(p.course_slug);
UPDATE public.community_comments c SET course_slug=p.course_slug FROM public.community_posts p
WHERE p.id=c.post_id AND c.course_slug IS DISTINCT FROM p.course_slug;
UPDATE public.community_reports r SET course_slug=p.course_slug FROM public.community_posts p
WHERE p.id=r.post_id AND r.course_slug IS DISTINCT FROM p.course_slug;

-- No cascading deletion or guessed retention policy. Referenced IDs cannot
-- become orphans and later be acquired by another creator.
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_course_id_fkey FOREIGN KEY(course_slug) REFERENCES public.courses(id);
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_course_id_fkey FOREIGN KEY(course_slug) REFERENCES public.courses(id);
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_course_id_fkey FOREIGN KEY(course_slug) REFERENCES public.courses(id);
ALTER TABLE public.course_events ADD CONSTRAINT course_events_course_id_fkey FOREIGN KEY(course_id) REFERENCES public.courses(id);

ALTER POLICY community_posts_insert_enrolled ON public.community_posts
WITH CHECK(author_id=(SELECT auth.uid())::text AND public.has_enrollment_for_course_slug(course_slug)
  AND coalesce(pinned,false)=false AND EXISTS(SELECT FROM public.courses c WHERE c.id=course_slug AND c.community_enabled));
CREATE POLICY community_posts_insert_course_teacher ON public.community_posts FOR INSERT
WITH CHECK(author_id=(SELECT auth.uid())::text AND public.owns_course_reference(course_slug)
  AND coalesce(pinned,false)=false AND EXISTS(SELECT FROM public.courses c WHERE c.id=course_slug AND c.community_enabled));

-- Event labels can be stale. Both visibility and RSVP authority use the
-- referenced event's course_id; a different enrollment cannot satisfy them.
ALTER POLICY course_events_select_enrolled ON public.course_events
USING(public.has_enrollment_for_course_slug(course_id));
ALTER POLICY course_event_rsvps_insert_owner ON public.course_event_rsvps
WITH CHECK(uid=(SELECT auth.uid())::text AND EXISTS(
  SELECT FROM public.course_events ev WHERE ev.id=course_event_rsvps.event_id AND ev.status='scheduled'
    AND public.has_enrollment_for_course_slug(ev.course_id)));
ALTER POLICY course_event_rsvps_update_owner ON public.course_event_rsvps
USING(uid=(SELECT auth.uid())::text AND EXISTS(
  SELECT FROM public.course_events ev WHERE ev.id=course_event_rsvps.event_id AND ev.status='scheduled'
    AND public.has_enrollment_for_course_slug(ev.course_id)))
WITH CHECK(uid=(SELECT auth.uid())::text AND EXISTS(
  SELECT FROM public.course_events ev WHERE ev.id=course_event_rsvps.event_id AND ev.status='scheduled'
    AND public.has_enrollment_for_course_slug(ev.course_id)));

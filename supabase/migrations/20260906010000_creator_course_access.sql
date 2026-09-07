-- Email authority is Auth, never the editable public profile. No email is sent here.
CREATE TABLE public.course_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id text NOT NULL REFERENCES public.courses(id),
  learner_email text NOT NULL CHECK (learner_email = lower(btrim(learner_email)) AND length(learner_email) <= 254 AND learner_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  granted_by text NOT NULL REFERENCES public.users(uid),
  claimed_by uuid REFERENCES auth.users(id),
  claimed_at timestamptz,
  access_status text NOT NULL DEFAULT 'pending' CHECK (access_status IN ('pending','granted','preserved','revoked','conflict')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(course_id, learner_email)
);
CREATE INDEX course_access_grants_email_pending ON public.course_access_grants(learner_email) WHERE revoked_at IS NULL;
ALTER TABLE public.enrollments ADD COLUMN creator_grant_id uuid REFERENCES public.course_access_grants(id);
ALTER TABLE public.enrollments DROP CONSTRAINT enrollments_source_check;
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_source_check CHECK(source IN ('manual_demo','free_course','payment','admin','subscription','creator'));
-- The learner's existing UPDATE permission must not detach a revocable grant.
CREATE OR REPLACE FUNCTION public.enrollments_owner_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_service_role() OR public.is_admin() OR current_setting('skillset.trusted_write',true)='on' THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
    OR NEW.course_title IS DISTINCT FROM OLD.course_title OR NEW.course_category IS DISTINCT FROM OLD.course_category
    OR NEW.course_image IS DISTINCT FROM OLD.course_image OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.source IS DISTINCT FROM OLD.source OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
    OR NEW.progress_percent IS DISTINCT FROM OLD.progress_percent OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.creator_grant_id IS DISTINCT FROM OLD.creator_grant_id THEN
    RAISE EXCEPTION 'enrollments: owners may only update last_lesson_id and updated_at';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE public.course_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_access_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_access_grants TO authenticated;
CREATE POLICY course_access_grants_owner_select ON public.course_access_grants FOR SELECT TO authenticated
USING (granted_by = auth.uid()::text AND public.session_is_strong() AND EXISTS (
  SELECT FROM public.courses c WHERE c.id=course_id AND c.owner_id=auth.uid()::text
));

-- Private shared writer: the owner grant and self claim both use this path.
-- The grant is row-locked by the caller; enrollment UPSERT + row lock serializes
-- with payment writes on the canonical enrollment primary key.
CREATE FUNCTION public.apply_course_access_grant(p_grant_id uuid, p_uid uuid)
RETURNS public.course_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g public.course_access_grants; c public.courses; e public.enrollments; v_changed boolean := false;
BEGIN
  SELECT * INTO STRICT g FROM public.course_access_grants WHERE id=p_grant_id FOR UPDATE;
  IF g.revoked_at IS NOT NULL THEN RETURN g; END IF;
  IF g.claimed_by IS NOT NULL AND g.claimed_by <> p_uid THEN
    UPDATE public.course_access_grants SET access_status='conflict',updated_at=now() WHERE id=g.id RETURNING * INTO g;
    RETURN g;
  END IF;
  IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_uid AND email_confirmed_at IS NOT NULL AND lower(email)=g.learner_email) THEN RETURN g; END IF;
  SELECT * INTO c FROM public.courses WHERE id=g.course_id AND status='published' AND owner_id=g.granted_by FOR SHARE;
  IF NOT FOUND THEN RETURN g; END IF;
  INSERT INTO public.enrollments(id,user_id,course_id,course_slug,course_title,course_category,course_image,status,source,progress_percent,created_at,updated_at,creator_grant_id)
  VALUES(p_uid::text || '__' || c.id,p_uid::text,c.id,c.id,c.title,c.category,coalesce(c.cover_image_url,''),'active','creator',0,now(),now(),g.id)
  ON CONFLICT(id) DO NOTHING;
  v_changed := FOUND;
  SELECT * INTO STRICT e FROM public.enrollments WHERE id=p_uid::text || '__' || c.id FOR UPDATE;
  IF e.source='creator' AND e.creator_grant_id=g.id THEN
    IF e.status NOT IN ('active','completed') THEN
      PERFORM set_config('skillset.trusted_write','on',true);
      UPDATE public.enrollments SET status=CASE WHEN progress_percent>=100 THEN 'completed' ELSE 'active' END,updated_at=now() WHERE id=e.id;
      PERFORM set_config('skillset.trusted_write','off',true);
      v_changed := true;
    END IF;
    g.access_status := 'granted';
  ELSIF e.status IN ('active','completed') THEN g.access_status := 'preserved';
  ELSE g.access_status := 'conflict'; END IF;
  UPDATE public.course_access_grants SET claimed_by=p_uid,claimed_at=coalesce(claimed_at,now()),access_status=g.access_status,updated_at=now()
    WHERE id=g.id RETURNING * INTO g;
  IF v_changed THEN
    INSERT INTO public.notifications(notification_id,user_id,type,title,body,link,actor_name,read,created_at)
    VALUES(gen_random_uuid()::text,p_uid::text,'enrollment','Course access granted','Your course is ready in your learning workspace.','/learn/courses/' || c.id,'Course creator',false,now());
    PERFORM public.log_audit_event('course_access.claim',p_uid::text,null,'course_access_grant',g.id::text,'Course access granted',jsonb_build_object('courseId',c.id));
  END IF;
  RETURN g;
END $$;
REVOKE ALL ON FUNCTION public.apply_course_access_grant(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.grant_course_access(p_course_id text,p_email text)
RETURNS public.course_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g public.course_access_grants; v_email text:=lower(btrim(p_email)); v_uid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.session_is_strong() OR NOT EXISTS (
    SELECT FROM public.courses WHERE id=p_course_id AND owner_id=auth.uid()::text AND status='published'
  ) THEN RAISE EXCEPTION 'Course owner and published course required' USING ERRCODE='42501'; END IF;
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023';
  END IF;
  PERFORM public.enforce_rate_limit('course_grant_rpc_' || auth.uid()::text,30,3600000);
  INSERT INTO public.course_access_grants(course_id,learner_email,granted_by)
    VALUES(p_course_id,v_email,auth.uid()::text) ON CONFLICT(course_id,learner_email) DO NOTHING;
  SELECT * INTO STRICT g FROM public.course_access_grants WHERE course_id=p_course_id AND learner_email=v_email FOR UPDATE;
  IF g.granted_by<>auth.uid()::text THEN RAISE EXCEPTION 'Grant belongs to another creator' USING ERRCODE='42501'; END IF;
  UPDATE public.course_access_grants SET revoked_at=null,access_status=CASE WHEN revoked_at IS NOT NULL THEN 'pending' ELSE access_status END,updated_at=now() WHERE id=g.id RETURNING * INTO g;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email)=v_email AND email_confirmed_at IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_uid IS NOT NULL THEN g:=public.apply_course_access_grant(g.id,v_uid); END IF;
  PERFORM public.log_audit_event('course_access.grant',auth.uid()::text,null,'course_access_grant',g.id::text,'Course access recorded',jsonb_build_object('courseId',p_course_id));
  RETURN g;
END $$;

CREATE FUNCTION public.claim_my_course_grants()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g public.course_access_grants; v_email text; v_count integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.session_is_strong() THEN RAISE EXCEPTION 'Strong session required' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN 0; END IF;
  FOR g IN SELECT * FROM public.course_access_grants WHERE learner_email=v_email AND revoked_at IS NULL AND (claimed_by IS NULL OR claimed_by=auth.uid()) ORDER BY id FOR UPDATE LOOP
    g:=public.apply_course_access_grant(g.id,auth.uid());
    IF g.access_status='granted' THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END $$;

CREATE FUNCTION public.revoke_course_access(p_grant_id uuid)
RETURNS public.course_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g public.course_access_grants;
BEGIN
  IF auth.uid() IS NULL OR NOT public.session_is_strong() THEN RAISE EXCEPTION 'Strong session required' USING ERRCODE='42501'; END IF;
  SELECT * INTO g FROM public.course_access_grants WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND OR g.granted_by<>auth.uid()::text OR NOT EXISTS(SELECT FROM public.courses WHERE id=g.course_id AND owner_id=auth.uid()::text) THEN
    RAISE EXCEPTION 'Course owner required' USING ERRCODE='42501';
  END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN g; END IF;
  PERFORM set_config('skillset.trusted_write','on',true);
  UPDATE public.enrollments SET status='revoked',updated_at=now()
    WHERE id=g.claimed_by::text || '__' || g.course_id AND source='creator' AND creator_grant_id=g.id;
  PERFORM set_config('skillset.trusted_write','off',true);
  UPDATE public.course_access_grants SET revoked_at=now(),updated_at=now(),access_status='revoked' WHERE id=g.id RETURNING * INTO g;
  PERFORM public.log_audit_event('course_access.revoke',auth.uid()::text,null,'course_access_grant',g.id::text,'Creator access revoked',jsonb_build_object('courseId',g.course_id));
  RETURN g;
END $$;
REVOKE ALL ON FUNCTION public.grant_course_access(text,text),public.claim_my_course_grants(),public.revoke_course_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grant_course_access(text,text),public.claim_my_course_grants(),public.revoke_course_access(uuid) TO authenticated;

-- Payment may finish while the creator is revoking a grant. Resolve access
-- against the CURRENT row in the same UPSERT, never a previous JS SELECT.
CREATE FUNCTION public.fulfill_paid_course_access(p_user_id text,p_course_id text,p_source text,p_subscription_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.courses;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('payment','subscription')
    OR NOT EXISTS(SELECT FROM auth.users WHERE id::text=p_user_id)
    OR (p_source='subscription' AND (p_subscription_id IS NULL OR length(p_subscription_id)=0 OR length(p_subscription_id)>200)) THEN
    RAISE EXCEPTION 'Invalid paid enrollment' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT c FROM public.courses WHERE id=p_course_id;
  INSERT INTO public.enrollments AS e(id,user_id,course_id,course_slug,course_title,course_category,course_image,status,source,subscription_id,progress_percent,created_at,updated_at)
  VALUES(p_user_id || '__' || c.id,p_user_id,c.id,c.id,c.title,c.category,coalesce(nullif(c.cover_image_url,''),'/brand/logo-mark.png'),'active',p_source,p_subscription_id,0,now(),now())
  ON CONFLICT(id) DO UPDATE SET
    status=CASE WHEN e.status IN ('active','completed') THEN e.status ELSE 'active' END,
    source=excluded.source,
    subscription_id=CASE WHEN p_source='subscription' THEN excluded.subscription_id ELSE e.subscription_id END,
    creator_grant_id=NULL,
    updated_at=now()
  WHERE e.status NOT IN ('active','completed') OR e.source='creator';
END $$;
REVOKE ALL ON FUNCTION public.fulfill_paid_course_access(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_paid_course_access(text,text,text,text) TO service_role;

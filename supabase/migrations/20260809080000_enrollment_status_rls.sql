-- Three RLS policies granted access on "an enrollment row exists" instead of
-- "an enrollment row exists AND it still entitles you". A refund, a revoke or an
-- expiry leaves the row in place with a new status, so the student kept reading
-- everything the paywall was supposed to close.
--
-- The rule already exists twice in this database and once in the app:
--
--   course_assets_select            e.status = ANY(ARRAY['active','completed'])
--   storage objects/course_content  e.status = ANY(ARRAY['active','completed'])
--   src/domain/enrollment.ts:54     canOpenEnrollment() -> active | completed
--
-- These three were written without it. Worst is course_lesson_content: it holds
-- content_text and external_url — the paywalled lesson body and the raw video
-- URL the teacher pasted — so a refunded student could still pull the whole
-- course in one REST call.
--
-- No new helper: the two correct policies inline the array, so these match them
-- character for character. One predicate, five places, easy to eyeball.
--
-- Deliberately NOT changed: lesson_progress_select_owner. It returns the user's
-- own progress rows, which are theirs whatever the enrollment status — reading
-- your own history after a refund leaks nothing.

-- The paywall itself: lesson body text + the teacher's video URL.
drop policy if exists course_lesson_content_select on public.course_lesson_content;
create policy course_lesson_content_select on public.course_lesson_content
  as permissive for select to public
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = course_lesson_content.course_id
        and c.owner_id = (select auth.uid())::text
    )
    or exists (
      select 1 from public.enrollments e
      where e.course_id = course_lesson_content.course_id
        and e.user_id = (select auth.uid())::text
        and e.status = any (array['active'::text, 'completed'::text])
    )
  );

-- Private classroom discussion between the teacher and the people who paid.
drop policy if exists lesson_comments_select on public.lesson_comments;
create policy lesson_comments_select on public.lesson_comments
  as permissive for select to public
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = lesson_comments.course_id
        and c.owner_id = (select auth.uid())::text
    )
    or exists (
      select 1 from public.enrollments e
      where e.course_id = lesson_comments.course_id
        and e.user_id = (select auth.uid())::text
        and e.status = any (array['active'::text, 'completed'::text])
    )
  );

-- Reviews of published courses stay public via the first branch, and the author
-- keeps their own review via the id branch. Only the enrollment branch tightens,
-- so this is consistency more than exposure — but a security predicate that is
-- right in four places and different in the fifth is the one that gets copied.
drop policy if exists course_reviews_select on public.course_reviews;
create policy course_reviews_select on public.course_reviews
  as permissive for select to public
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = course_reviews.course_id
        and c.status = any (array['published'::text, 'in_review'::text])
    )
    or (
      (select auth.uid()) is not null
      and (
        id = course_reviews.course_id || '__' || (select auth.uid())::text
        or exists (
          select 1 from public.courses c
          where c.id = course_reviews.course_id
            and c.owner_id = (select auth.uid())::text
        )
        or exists (
          select 1 from public.enrollments e
          where e.course_id = course_reviews.course_id
            and e.user_id = (select auth.uid())::text
            and e.status = any (array['active'::text, 'completed'::text])
        )
      )
    )
  );

-- Self-check: every policy that consults enrollments must also consult status.
-- lesson_progress_select_owner is the documented exception above.
do $$
declare
  offenders text;
begin
  select string_agg(c.relname || '.' || p.polname, ', ')
    into offenders
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where pg_get_expr(p.polqual, p.polrelid) ilike '%enrollments%'
    and pg_get_expr(p.polqual, p.polrelid) not ilike '%e.status%'
    and p.polname <> 'lesson_progress_select_owner';

  if offenders is not null then
    raise exception 'RLS policies read enrollments without checking status: %', offenders;
  end if;
end $$;

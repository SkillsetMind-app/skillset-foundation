\set ON_ERROR_STOP on
-- Disposable database only. Fixtures go back on ROLLBACK.
--
-- The course owner moderates their own community
-- (20261008010000_comunidade_moderada_pelo_dono.sql):
--   - deletes a learner's post and comment in their course, and the replies go along;
--   - deletes nothing and unpins nothing in the community of ANOTHER course;
--   - pins and unpins, but does not rewrite the learner's title, text or lesson;
--   - a learner deletes only what they wrote (post and comment);
--   - the accepted reply goes when the reply goes: deleted by the author, by the
--     owner, in cascade with the parent reply or with the post;
--   - the date of the post and of the reply is the server's; the trusted write
--     (data-only restore) keeps the date that came in;
--   - the report reaches the /ops queue with the author, the name and the date that the
--     database checked; a reply from another post, one's own reply, someone who is not
--     in the course and the second open report are refused;
--   - a report signed with someone else's id stops before the duplicate check
--     (otherwise it would say who reported); someone who is not in the course gets the
--     same refusal, with or without the reply on the post;
--   - a null pinned sent on purpose is refused;
--   - the functions are definer, with a fixed search_path, and nobody calls them directly.
-- All through the real path: each one writes under RLS.
begin;
create temp table mod_checks (name text, passed boolean);
grant insert, select on mod_checks to authenticated;
create function pg_temp.check_mod(p_name text, p_ok boolean) returns void
language sql as $$ insert into mod_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61008010-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Rows the command changed. RLS refuses UPDATE and DELETE silently (0 rows).
create function pg_temp.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- The command fails with this SQLSTATE. If it passes, it is undone and counts as a failure.
create function pg_temp.fails_with(p_sql text, p_state text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception when others then
  return sqlstate = p_state;
end $$;
-- 'SQLSTATE: message' of the error. If it passes, it is undone and returns 'Z0001: no error'.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'no error' using errcode = 'Z0001';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- 1 owner of course A · 2 learner of A · 3 learner of A · 4 owner of course B
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'mod-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (4)) owners(n);
update public.users set display_name = 'Mod ' || right(uid, 1)
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 4) n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(4)::text);
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency, community_enabled)
values
  ('smoke-mod-a', pg_temp.uid(1)::text, 'smoke-mod-a-slug', 'Smoke mod A', 'smoke-mod-a',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true),
  ('smoke-mod-b', pg_temp.uid(4)::text, 'smoke-mod-b-slug', 'Smoke mod B', 'smoke-mod-b',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true);
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
select pg_temp.uid(n)::text || '__smoke-mod-a', pg_temp.uid(n)::text, 'smoke-mod-a', 'smoke-mod-a',
  'Smoke mod A', 'smoke', '', 'active', 'admin'
from generate_series(2, 3) n;
select set_config('skillset.trusted_write', 'off', true);

-- Learner 2 asks a question and chats; the browser sends a date of 2099.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, title, body,
  created_at, updated_at)
values
  ('smoke-mod-q', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'question', 'Where is the file?',
   'Synthetic question.', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z'),
  ('smoke-mod-d', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'discussion', null,
   'Synthetic discussion.', null, null);
reset role;
-- Learner 3 replies three times (the first also with a date of 2099) and
-- replies to their own third reply.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body, created_at)
values
  ('smoke-mod-c1', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic answer.',
   '2099-01-01T00:00:00Z'),
  ('smoke-mod-c2', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic reply.', null),
  ('smoke-mod-c3', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic second thought.', null);
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body, parent_id)
values ('smoke-mod-c4', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student',
  'Synthetic follow-up.', 'smoke-mod-c3');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a post dated in the future gets the server time',
  (select created_at = now() and updated_at = now() from public.community_posts where id = 'smoke-mod-q'));
select pg_temp.check_mod('a reply dated in the future gets the server time',
  (select created_at = now() from public.community_comments where id = 'smoke-mod-c1'));
-- Data-only restore (skillset.trusted_write) keeps the date that came in.
select set_config('skillset.trusted_write', 'on', true);
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, body,
  created_at, updated_at)
values ('smoke-mod-r', 'smoke-mod-a', pg_temp.uid(2)::text, 'Mod 2', 'student', 'discussion',
  'Synthetic restored post.', '2001-01-01T00:00:00Z', '2001-02-01T00:00:00Z');
select set_config('skillset.trusted_write', 'off', true);
select pg_temp.check_mod('a trusted restore keeps the post''s own dates',
  (select created_at = '2001-01-01T00:00:00Z' and updated_at = '2001-02-01T00:00:00Z'
     from public.community_posts where id = 'smoke-mod-r'));
-- The chat post is born pinned (the database does not allow pinning on insert).
update public.community_posts set pinned = true where id = 'smoke-mod-d';

-- The owner of ANOTHER course deletes nothing and unpins nothing in A.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('another course owner cannot delete a post here',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
select pg_temp.check_mod('another course owner cannot delete a comment here',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c2'$q$) = 0);
select pg_temp.check_mod('another course owner cannot unpin here',
  pg_temp.affected($q$update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d'$q$) = 0);
reset role;

-- A learner does not delete or unpin what belongs to someone else.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s post',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 0);
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a member cannot delete someone else''s comment, even on her own post',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$) = 0);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member cannot unpin',
  (select pinned from public.community_posts where id = 'smoke-mod-d'));

-- The owner of A pins, but does not rewrite what the learner wrote.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the course owner cannot rewrite a member''s title',
  pg_temp.fails_with($q$update public.community_posts set title = 'This course is a scam', updated_at = now()
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot rewrite a member''s text',
  pg_temp.fails_with($q$update public.community_posts set body = 'Rewritten by the owner.', updated_at = now()
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot move a member''s question to another lesson',
  pg_temp.fails_with($q$update public.community_posts set lesson_id = 'smoke-lesson', lesson_title = 'Smoke lesson'
    where id = 'smoke-mod-q'$q$, 'P0001'));
select pg_temp.check_mod('the course owner cannot rewrite a member''s reply',
  pg_temp.affected($q$update public.community_comments set body = 'Rewritten by the owner.'
    where id = 'smoke-mod-c2'$q$) = 0);
select pg_temp.check_mod('the course owner pins a member''s post',
  pg_temp.affected($q$update public.community_posts set pinned = true, updated_at = now()
    where id = 'smoke-mod-q'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the member''s words stay as she wrote them',
  (select title = 'Where is the file?' and body = 'Synthetic question.' and lesson_id is null and lesson_title is null
     and pinned
   from public.community_posts where id = 'smoke-mod-q')
  and (select body = 'Synthetic reply.' from public.community_comments where id = 'smoke-mod-c2'));

-- Report: learner 3 sends an invented author, name and date; the database swaps them.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_reports(course_slug, post_id, comment_id, target_type, target_author_id,
  target_author_name, reporter_id, reporter_name, reporter_email, reason, detail, status, created_at)
values ('smoke-mod-a', 'smoke-mod-d', null, 'post', pg_temp.uid(4)::text, 'Forged victim',
  pg_temp.uid(3)::text, 'Forged reporter', 'forged@example.test', 'spam', 'Synthetic report.', 'open',
  '2001-01-01T00:00:00Z');
select pg_temp.check_mod('a second open report of the same post is refused',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 3', 'other', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '23505'));
select pg_temp.check_mod('a reply report must name the reply''s own post',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', 'smoke-mod-c1', 'comment', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '42501'));
select pg_temp.check_mod('nobody reports their own reply',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text), '42501'));
reset role;
-- Learner 2 reports a reply from learner 3, saying it is the owner's.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
insert into public.community_reports(course_slug, post_id, comment_id, target_type, target_author_id,
  target_author_name, reporter_id, reporter_name, reason, status)
values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', pg_temp.uid(1)::text, 'Forged owner',
  pg_temp.uid(2)::text, 'Mod 2', 'harassment', 'open');
-- The author of smoke-mod-d signs with learner 3's id, who has an open report
-- there. If the duplicate were checked first, the 23505 would say it was them.
select pg_temp.check_mod('a report signed with someone else''s id stops before the duplicate check',
  pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 3', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(3)::text)) = '42501: community_reports: the reporter must be the caller');
select pg_temp.check_mod('the reported author does not read the report against her',
  not exists (select 1 from public.community_reports where post_id = 'smoke-mod-d'));
reset role;
-- Someone who is not in course A reports nothing there.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('someone outside the course cannot report there',
  pg_temp.fails_with(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', null, 'post', %L, 'Mod 2', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(2)::text, pg_temp.uid(4)::text), '42501'));
-- c1 is not from smoke-mod-d; c2 is from smoke-mod-q. The refusal is the same.
select pg_temp.check_mod('an outsider gets the same refusal whether or not the reply is in the post',
  pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-d', 'smoke-mod-c1', 'comment', %L, 'Mod 3', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(3)::text, pg_temp.uid(4)::text)) = '42501: community_reports: the reporter cannot see this post'
  and pg_temp.error_of(format($q$insert into public.community_reports(course_slug, post_id, comment_id, target_type,
    target_author_id, target_author_name, reporter_id, reporter_name, reason, status)
    values ('smoke-mod-a', 'smoke-mod-q', 'smoke-mod-c2', 'comment', %L, 'Mod 3', %L, 'Mod 4', 'spam', 'open')$q$,
    pg_temp.uid(3)::text, pg_temp.uid(4)::text)) = '42501: community_reports: the reporter cannot see this post');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a post report reaches the ops queue with the real author, reporter and time',
  exists (select 1 from public.community_reports
    where post_id = 'smoke-mod-d' and comment_id is null and reporter_id = pg_temp.uid(3)::text
      and course_slug = 'smoke-mod-a' and status = 'open' and reason = 'spam'
      and target_author_id = pg_temp.uid(2)::text and target_author_name = 'Mod 2'
      and reporter_name = 'Mod 3' and reporter_email = 'mod-smoke-3@example.test'
      and created_at = now()));
select pg_temp.check_mod('a reply report names the reply''s real author',
  exists (select 1 from public.community_reports
    where comment_id = 'smoke-mod-c2' and post_id = 'smoke-mod-q' and reporter_id = pg_temp.uid(2)::text
      and target_author_id = pg_temp.uid(3)::text and target_author_name = 'Mod 3'
      and reporter_name = 'Mod 2'));
select pg_temp.check_mod('only the two real reports were stored',
  (select count(*) = 2 from public.community_reports where course_slug = 'smoke-mod-a'));

-- The accepted reply goes when the reply goes, by any path.
-- 1) The learner deletes their own accepted reply.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c1', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the author still deletes his own comment',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c1'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('a member deleting his own accepted answer clears it',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null);
-- 2) The owner deletes the accepted reply.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c2', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the course owner deletes a member''s comment',
  pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c2'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the owner deleting the accepted answer clears it',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null);
-- 3) The accepted reply was a reply to another reply, and the parent was deleted.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c4', updated_at = now() where id = 'smoke-mod-q';
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.affected($q$delete from public.community_comments where id = 'smoke-mod-c3'$q$);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('an accepted reply that goes with its parent clears the mark',
  (select accepted_comment_id from public.community_posts where id = 'smoke-mod-q') is null
  and not exists (select 1 from public.community_comments where id in ('smoke-mod-c3', 'smoke-mod-c4')));
-- 4) The post goes with the accepted reply inside.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-mod-c5', 'smoke-mod-q', 'smoke-mod-a', pg_temp.uid(3)::text, 'Mod 3', 'student', 'Synthetic final answer.');
reset role;
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
update public.community_posts set accepted_comment_id = 'smoke-mod-c5', updated_at = now() where id = 'smoke-mod-q';
reset role;

-- The owner unpins the chat and deletes the question (with the accepted reply).
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
update public.community_posts set pinned = false, updated_at = now() where id = 'smoke-mod-d';
select pg_temp.check_mod('the course owner deletes a member''s post, accepted answer and all',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-q'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_mod('the course owner unpins',
  not (select pinned from public.community_posts where id = 'smoke-mod-d'));
select pg_temp.check_mod('the post''s replies went with it',
  not exists (select 1 from public.community_comments where post_id = 'smoke-mod-q'));

-- The author keeps deleting what they wrote.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('the author still deletes her own post',
  pg_temp.affected($q$delete from public.community_posts where id = 'smoke-mod-d'$q$) = 1);
reset role;

-- The functions: SECURITY DEFINER, fixed search_path, nobody outside executes.
select pg_temp.check_mod('functions: security definer with a fixed search_path',
  (select count(*) = 4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'])
     from pg_proc p
     where p.oid in ('public.community_comments_clear_accepted_answer()'::regprocedure,
                     'public.community_posts_update_guard()'::regprocedure,
                     'public.community_stamp_created_at()'::regprocedure,
                     'public.community_reports_trusted_fields()'::regprocedure)));
select pg_temp.check_mod('functions: anon and authenticated cannot call them',
  not exists (
    select 1
    from unnest(array['public.community_comments_clear_accepted_answer()',
                      'public.community_posts_update_guard()',
                      'public.community_stamp_created_at()',
                      'public.community_reports_trusted_fields()']) f,
         unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, f, 'execute')));
select pg_temp.check_mod('posts default to not pinned',
  (select pg_get_expr(d.adbin, d.adrelid) = 'false'
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.community_posts'::regclass and a.attname = 'pinned'));
-- The insert policy uses coalesce(pinned, false): the not null is what refuses the null.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_mod('a post cannot be saved with pinned empty',
  pg_temp.fails_with(format($q$insert into public.community_posts(id, course_slug, author_id, author_name, author_role,
    category, body, pinned)
    values ('smoke-mod-n', 'smoke-mod-a', %L, 'Mod 2', 'student', 'discussion', 'Synthetic post.', null)$q$,
    pg_temp.uid(2)::text), '23502'));
reset role;

select pg_temp.check_mod('every case ran', (select count(*) = 38 from mod_checks));
select name, passed from mod_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from mod_checks where not passed;
  if failures is not null then
    raise exception 'COMMUNITY_MODERATION_REGRESSION: %', failures;
  end if;
end $$;
rollback;

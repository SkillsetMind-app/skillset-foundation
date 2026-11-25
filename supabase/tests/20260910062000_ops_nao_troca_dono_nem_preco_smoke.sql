\set ON_ERROR_STOP on
-- Disposable database only. Fixtures are undone in the ROLLBACK.
--
-- P1-2: ops does not change the owner, price or fee of someone else's course and still
-- moderates status. The owner still changes their own price. Admin and server
-- change them, and a change made by someone who is not the owner is recorded in the audit_log, which fails
-- closed.
begin;
create temp table owner_price_checks (name text, passed boolean);
grant insert, select on owner_price_checks to authenticated;
create function pg_temp.check_course(p_name text, p_ok boolean) returns void
language sql as $$ insert into owner_price_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true only when the write was refused with this message; the one that went through is undone.
create function pg_temp.refused(p_sql text, p_message text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then return sqlerrm = p_message;
end $$;
create function pg_temp.accepted(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return true;
  when others then return false;
end $$;

-- 1 owner, 2 accomplice with their own course, 3 ops, 4 admin.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'owner-price-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1), (2)) owners(n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(2)::text);
update public.users set roles = '["student","ops"]' where uid = pg_temp.uid(3)::text;
update public.users set roles = '["student","admin"]' where uid = pg_temp.uid(4)::text;
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
  payment_type, price_amount_minor, currency, platform_fee_bps)
values ('owner-price-course', pg_temp.uid(1)::text, 'owner-price-course', 'Owner and price fixture',
  'owner-price-course', 'Synthetic course for the owner and price smoke.', 'smoke', 'published',
  'one_time', 5000, 'USD', 1000);

-- Ops, through the real path: courses_update_ops lets the row pass through RLS.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select pg_temp.check_course('ops cannot transfer the course',
  pg_temp.refused(format('update public.courses set owner_id = %L where id = %L',
    pg_temp.uid(2)::text, 'owner-price-course'),
    'courses: owner_id and platform_fee_bps are privileged (admin/service only)'));
select pg_temp.check_course('ops cannot zero the price',
  pg_temp.refused($q$update public.courses set price_amount_minor = 0 where id = 'owner-price-course'$q$,
    'courses: price fields may only change by the course owner, an admin or the server'));
select pg_temp.check_course('ops cannot make the course free',
  pg_temp.refused($q$update public.courses set payment_type = 'free' where id = 'owner-price-course'$q$,
    'courses: price fields may only change by the course owner, an admin or the server'));
select pg_temp.check_course('ops cannot change the platform fee',
  pg_temp.refused($q$update public.courses set platform_fee_bps = 0 where id = 'owner-price-course'$q$,
    'courses: owner_id and platform_fee_bps are privileged (admin/service only)'));
-- Status that stays visible to ops: in an UPDATE with a WHERE, RLS requires that
-- the new row also pass the SELECT policies.
select pg_temp.check_course('ops can still send a course back to review',
  pg_temp.accepted($q$update public.courses set status = 'in_review', review_note = 'Synthetic moderation note.' where id = 'owner-price-course'$q$));
reset role;

-- The owner changes their own price, and that does not become an audit row.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
update public.courses set price_amount_minor = 4000 where id = 'owner-price-course';
reset role;
select pg_temp.check_course('owner can still change the own price',
  (select price_amount_minor = 4000 from public.courses where id = 'owner-price-course'));
select pg_temp.check_course('owner price change is not audited as a third-party change',
  not exists (select 1 from public.audit_log where target_type = 'course' and target_id = 'owner-price-course'));

-- Admin transfers the course, and the change is recorded in the audit_log.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
update public.courses set owner_id = pg_temp.uid(2)::text where id = 'owner-price-course';
reset role;
select pg_temp.check_course('admin can transfer the course',
  (select owner_id = pg_temp.uid(2)::text from public.courses where id = 'owner-price-course'));
select pg_temp.check_course('admin transfer is audited with previous and next owner',
  exists (select 1 from public.audit_log
    where action = 'course.owner_changed' and target_type = 'course' and target_id = 'owner-price-course'
      and actor_id = pg_temp.uid(4)::text
      and metadata->'previous'->>'owner_id' = pg_temp.uid(1)::text
      and metadata->'next'->>'owner_id' = pg_temp.uid(2)::text));

-- The server (offers route) changes the price; it is also recorded.
select pg_temp.act_as(null, 'service_role');
update public.courses set price_amount_minor = 3000 where id = 'owner-price-course';
select pg_temp.check_course('server price change is audited as the server',
  exists (select 1 from public.audit_log
    where action = 'course.price_changed' and target_id = 'owner-price-course'
      and actor_id = 'system:service_role'
      and metadata->'next'->>'price_amount_minor' = '3000'));

-- The audit fails closed: without the row in the audit_log, the owner does not change.
create function public.owner_price_smoke_reject_audit() returns trigger language plpgsql as $$
begin
  if new.target_id = 'owner-price-course' then raise exception 'SYNTHETIC_AUDIT_FAILURE'; end if;
  return new;
end $$;
create trigger owner_price_smoke_reject_audit before insert on public.audit_log
  for each row execute function public.owner_price_smoke_reject_audit();
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
select pg_temp.check_course('failed audit blocks the transfer',
  pg_temp.refused(format('update public.courses set owner_id = %L where id = %L',
    pg_temp.uid(1)::text, 'owner-price-course'), 'SYNTHETIC_AUDIT_FAILURE')
  and (select owner_id = pg_temp.uid(2)::text from public.courses where id = 'owner-price-course'));
drop trigger owner_price_smoke_reject_audit on public.audit_log;

select name, passed from owner_price_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from owner_price_checks where not passed;
  if failures is not null then
    raise exception 'OWNER_PRICE_REGRESSION: %', failures;
  end if;
end $$;
rollback;

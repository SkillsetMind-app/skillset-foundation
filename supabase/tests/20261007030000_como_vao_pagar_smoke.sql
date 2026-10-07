\set ON_ERROR_STOP on
-- Disposable database only. Fixtures roll back.
--
-- 20261007030000: each product type takes only its own ways to pay.
--   course: free, one payment, monthly or yearly membership
--   community: free, monthly or yearly membership
--   live_event: free, one payment (the ticket)
--   ebook: free, one payment
-- Creating, saving the builder, publishing, changing the type and adding an
-- extra price all refuse a way to pay the type does not take. A product
-- already set up the old way keeps its price and still saves other changes.
-- A live paid product never loses its price, and an extra price only sits
-- next to a main price (alone, checkout would charge it). With a main price,
-- the product's own price follows it: only the main price copies over.
begin;
create temp table pagar_checks (name text, passed boolean);
grant insert, select on pagar_checks to authenticated;
-- Before pg_temp.draft: a language sql body is checked when it is created.
create temp table drafts (key text primary key, id text);
grant insert, select on drafts to authenticated;
create function pg_temp.check_gate(p_name text, p_ok boolean) returns void
language sql as $$ insert into pagar_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86651007-0300-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- true only when the call fails with a message LIKE p_like. Success counts as
-- a failure and is undone.
create function pg_temp.refused(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'Z0001';
exception
  when sqlstate 'Z0001' then return false;
  when others then
    if sqlerrm not like p_like then
      raise warning 'unexpected refusal: %', sqlerrm;
    end if;
    return sqlerrm like p_like;
end $$;
create function pg_temp.passed(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise warning 'unexpected refusal: %', sqlerrm;
  return false;
end $$;
create function pg_temp.create_draft(p_title text, p_format text, p_payment text) returns text language sql as $$
  select format(
    $f$select public.create_teacher_course_draft(%L,
       'Product used only by the payment smoke test.', 'smoke', array['smoke'],
       %L, %L, %L, 'Module 1', 'Lesson 1')$f$,
    p_title, p_payment, p_format = 'community', p_format);
$$;
-- The builder's full-replace save, with only what the payment step sends.
create function pg_temp.save(p_course text, p_payment text, p_price int) returns text language sql as $$
  select format(
    'select public.update_teacher_course_builder(%L, %L::jsonb)',
    p_course,
    jsonb_build_object(
      'title', (select title from public.courses where id = p_course),
      'summary', 'Product used only by the payment smoke test.',
      'categories', jsonb_build_array('smoke'),
      'modules', (select modules from public.courses where id = p_course),
      'communityEnabled', (select community_enabled from public.courses where id = p_course),
      'paymentType', p_payment,
      'priceAmountMinor', p_price,
      'currency', 'USD'));
$$;
create function pg_temp.offer(p_course text, p_payment text, p_amount int, p_default boolean) returns text language sql as $$
  select format(
    'select public.create_product_offer_atomic(%L, %L, %L, %L, %L, %s, %L, %L, %L)',
    p_course, pg_temp.uid(1)::text, gen_random_uuid()::text, gen_random_uuid()::text,
    'Smoke ' || p_payment, p_amount, 'USD', p_payment, p_default);
$$;
create function pg_temp.draft(p_key text) returns text language sql as $$
  select id from drafts where key = p_key;
$$;

\set not_allowed 'PAYMENT_TYPE_NOT_ALLOWED_FOR_FORMAT:%'
\set needs_price 'PAID_PRODUCT_NEEDS_PRICE:%'
\set needs_main 'PRODUCT_OFFER_NEEDS_MAIN_PRICE:%'
\set follows_main 'COURSE_PRICE_FOLLOWS_MAIN_OFFER:%'

-- One activated creator, ready to sell.
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid(1), 'authenticated', 'authenticated', 'como-vao-pagar-1@example.test',
  now(), '{}', '{}', now(), now());
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(),
      teacher_terms_version = 'smoke', activation_fee_paid_at = now(),
      stripe_connected_account_id = 'acct_smoke_pagar',
      stripe_connect_charges_enabled = true, stripe_connect_payouts_enabled = true
  where uid = pg_temp.uid(1)::text;
delete from public.platform_settings where key = 'require_creator_verification';
insert into public.platform_settings(key, value) values ('require_creator_verification', 'false'::jsonb);

-- Set up the old way, before the rule: a community sold as one payment.
alter table public.courses disable trigger courses_payment_type_fits_format;
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, product_format, community_enabled, modules, lesson_count)
values ('smoke-pagar-legacy', pg_temp.uid(1)::text, 'smoke-pagar-legacy', 'Smoke pagar legacy',
  'Product used only by the payment smoke test.', 'smoke', 'draft', 'USD', 9900, 'one_time',
  'community', true, '[]'::jsonb, 0);
alter table public.courses enable trigger courses_payment_type_fits_format;
-- A free product from before payment_type existed: live, no type, no price.
insert into public.courses(id, owner_id, slug, title, summary, category, status, currency,
  price_amount_minor, payment_type, product_format, community_enabled, modules, lesson_count)
values ('smoke-pagar-legacy-free', pg_temp.uid(1)::text, 'smoke-pagar-legacy-free', 'Smoke pagar legacy free',
  'Product used only by the payment smoke test.', 'smoke', 'published', 'USD', null, null,
  'course', false, '[]'::jsonb, 0);
select set_config('skillset.trusted_write', 'off', true);

-- 1. Creation.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('create: a community cannot start as one payment',
  pg_temp.refused(pg_temp.create_draft('Smoke pagar c1', 'community', 'one_time'), :'not_allowed'));
select pg_temp.check_gate('create: a live event cannot start as monthly',
  pg_temp.refused(pg_temp.create_draft('Smoke pagar c2', 'live_event', 'subscription_monthly'), :'not_allowed'));
select pg_temp.check_gate('create: an e-book cannot start as yearly',
  pg_temp.refused(pg_temp.create_draft('Smoke pagar c3', 'ebook', 'subscription_yearly'), :'not_allowed'));
insert into drafts
select k.key, public.create_teacher_course_draft('Smoke pagar ' || k.key,
  'Product used only by the payment smoke test.', 'smoke', array['smoke'],
  k.payment, k.format = 'community', k.format, 'Module 1', 'Lesson 1')
from (values
  ('course', 'course', 'one_time'),
  ('community', 'community', 'subscription_monthly'),
  ('live', 'live_event', 'one_time'),
  ('ebook', 'ebook', 'one_time')
) k(key, format, payment);
select pg_temp.check_gate('create: each type starts with its own default',
  (select count(*) = 4 from drafts));

-- 2. Saving the builder.
select pg_temp.check_gate('save: a community cannot switch to one payment',
  pg_temp.refused(pg_temp.save(pg_temp.draft('community'), 'one_time', 9900), :'not_allowed'));
select pg_temp.check_gate('save: a live event cannot switch to monthly',
  pg_temp.refused(pg_temp.save(pg_temp.draft('live'), 'subscription_monthly', 2900), :'not_allowed'));
select pg_temp.check_gate('save: an e-book cannot switch to monthly',
  pg_temp.refused(pg_temp.save(pg_temp.draft('ebook'), 'subscription_monthly', 2900), :'not_allowed'));
select pg_temp.check_gate('save: a community switches to yearly',
  pg_temp.passed(pg_temp.save(pg_temp.draft('community'), 'subscription_yearly', 29000)));
select pg_temp.check_gate('save: a course switches to monthly',
  pg_temp.passed(pg_temp.save(pg_temp.draft('course'), 'subscription_monthly', 2900)));
select pg_temp.check_gate('save: a live event switches to free',
  pg_temp.passed(pg_temp.save(pg_temp.draft('live'), 'free', 0)));
select pg_temp.check_gate('save: a refused save wrote nothing',
  (select payment_type = 'one_time' from public.courses where id = pg_temp.draft('ebook')));

-- 3. A product set up the old way keeps its price and still saves.
select pg_temp.check_gate('existing: the old setup still saves other changes',
  pg_temp.passed(pg_temp.save('smoke-pagar-legacy', 'one_time', 9900)));
select pg_temp.check_gate('existing: its price setup did not change',
  (select payment_type = 'one_time' and price_amount_minor = 9900
     from public.courses where id = 'smoke-pagar-legacy'));

-- 4. Publishing.
select pg_temp.check_gate('publish: a way to pay the type does not take is refused',
  pg_temp.refused($q$select public.publish_teacher_course('smoke-pagar-legacy')$q$, :'not_allowed'));
select pg_temp.check_gate('publish: the refused product stays a draft',
  (select status = 'draft' from public.courses where id = 'smoke-pagar-legacy'));
select pg_temp.check_gate('publish: a community with a yearly membership publishes',
  pg_temp.passed(format('select public.publish_teacher_course(%L)', pg_temp.draft('community'))));

-- 4b. A live paid product never loses its price: a null price opened free
-- enrollment (create_free_course_enrollment reads null as zero).
select pg_temp.check_gate('live price: a published product cannot lose its price',
  pg_temp.refused(pg_temp.save(pg_temp.draft('community'), 'subscription_monthly', null), :'needs_price'));
select pg_temp.check_gate('live price: zero is no price either',
  pg_temp.refused(pg_temp.save(pg_temp.draft('community'), 'subscription_yearly', 0), :'needs_price'));
select pg_temp.check_gate('live price: the published product kept its price',
  (select payment_type = 'subscription_yearly' and price_amount_minor = 29000
     from public.courses where id = pg_temp.draft('community')));

-- 4c. The sales page saves copy through the same full-replace save. On a live
-- free product with no type and no price, it used to send one payment at 0.
select pg_temp.check_gate('legacy free: the old copy save (one payment at 0) is refused',
  pg_temp.refused(pg_temp.save('smoke-pagar-legacy-free', 'one_time', 0), :'needs_price'));
select pg_temp.check_gate('legacy free: the copy saves as free with the stored price',
  pg_temp.passed(pg_temp.save('smoke-pagar-legacy-free', 'free', null)));
select pg_temp.check_gate('legacy free: it is still free',
  (select payment_type = 'free' and price_amount_minor = 0
     from public.courses where id = 'smoke-pagar-legacy-free'));
reset role;

-- 5. Changing the type (service_role only) follows the same list.
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('type: a one-payment e-book cannot become a community',
  pg_temp.refused(format($q$update public.courses set product_format = 'community' where id = %L$q$,
    pg_temp.draft('ebook')), :'not_allowed'));

-- 6. Prices in Offers follow the type of the product, and an extra price only
-- sits next to a main price.
select pg_temp.check_gate('extra price: refused while the product has no main price',
  pg_temp.refused(pg_temp.offer(pg_temp.draft('ebook'), 'one_time', 990, false), :'needs_main'));
select pg_temp.check_gate('price: a live event cannot get a monthly price',
  pg_temp.refused(pg_temp.offer(pg_temp.draft('live'), 'subscription_monthly', 2900, true), :'not_allowed'));
select pg_temp.check_gate('main price: a community gets its yearly main price',
  pg_temp.passed(pg_temp.offer(pg_temp.draft('community'), 'subscription_yearly', 29000, true)));
select pg_temp.check_gate('main price: an e-book gets its main price',
  pg_temp.passed(pg_temp.offer(pg_temp.draft('ebook'), 'one_time', 1900, true)));
select pg_temp.check_gate('extra price: a community cannot get a one-payment price',
  pg_temp.refused(pg_temp.offer(pg_temp.draft('community'), 'one_time', 9900, false), :'not_allowed'));
select pg_temp.check_gate('extra price: a community gets a monthly price',
  pg_temp.passed(pg_temp.offer(pg_temp.draft('community'), 'subscription_monthly', 2900, false)));
select pg_temp.check_gate('extra price: an e-book gets another one-payment price',
  pg_temp.passed(pg_temp.offer(pg_temp.draft('ebook'), 'one_time', 990, false)));
select pg_temp.check_gate('extra price: the page still charges the main price',
  (select p.payment_type = 'subscription_yearly' and p.amount_minor = 29000
     from public.product_offers o
     join public.product_prices p on p.offer_id = o.id
    where o.course_id = pg_temp.draft('community') and o.is_default and o.active));

-- 6b. With a main price, checkout charges it, not the product's own price. A
-- builder opened before the main price existed cannot save another one.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_gate('main price: the builder cannot save a price checkout ignores',
  pg_temp.refused(pg_temp.save(pg_temp.draft('community'), 'subscription_monthly', 2900), :'follows_main'));
select pg_temp.check_gate('main price: nor can the owner update the price directly',
  pg_temp.refused(format($q$update public.courses set price_amount_minor = 100 where id = %L$q$,
    pg_temp.draft('community')), :'follows_main'));
select pg_temp.check_gate('main price: the builder still saves with the main price',
  pg_temp.passed(pg_temp.save(pg_temp.draft('community'), 'subscription_yearly', 29000)));
select pg_temp.check_gate('main price: the product kept the main price',
  (select payment_type = 'subscription_yearly' and price_amount_minor = 29000
     from public.courses where id = pg_temp.draft('community')));
select pg_temp.check_gate('no offers: the builder changes the price as before',
  pg_temp.passed(pg_temp.save(pg_temp.draft('course'), 'one_time', 4900)));
select pg_temp.check_gate('no offers: the new price is saved',
  (select payment_type = 'one_time' and price_amount_minor = 4900
     from public.courses where id = pg_temp.draft('course')));
reset role;

-- 6c. Making another price the main one copies it to the product, and only
-- inside that copy.
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_gate('sync: a new main price copies to the product',
  pg_temp.passed(format('select public.set_default_product_offer(%L, %L)', pg_temp.draft('ebook'),
    (select id from public.product_offers where course_id = pg_temp.draft('ebook') and not is_default))));
select pg_temp.check_gate('sync: the product now has that price',
  (select payment_type = 'one_time' and price_amount_minor = 990
     from public.courses where id = pg_temp.draft('ebook')));
select pg_temp.check_gate('sync: the pass ends with the copy',
  pg_temp.refused(format($q$update public.courses set price_amount_minor = 100 where id = %L$q$,
    pg_temp.draft('ebook')), :'follows_main'));

-- 7. The functions.
select pg_temp.check_gate('functions: fixed search_path; the price checks run as definer',
  (select bool_and(p.proconfig @> array['search_path=public, pg_temp'])
     from pg_proc p
    where p.oid in ('public.course_payment_type_fits_format(text, text)'::regprocedure,
                    'public.courses_payment_type_fits_format()'::regprocedure,
                    'public.product_prices_payment_type_fits_format()'::regprocedure,
                    'public.courses_price_follows_main_offer()'::regprocedure,
                    'public.set_default_product_offer(text, text)'::regprocedure))
  and (select bool_and(prosecdef) from pg_proc
        where oid in ('public.product_prices_payment_type_fits_format()'::regprocedure,
                      'public.courses_price_follows_main_offer()'::regprocedure))
  and not has_function_privilege('authenticated', 'public.set_default_product_offer(text, text)', 'execute'));

select pg_temp.check_gate('every case ran', (select count(*) = 41 from pagar_checks));

select name, passed from pagar_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from pagar_checks where not passed;
  if failures is not null then
    raise exception 'PAYMENT_BY_FORMAT_REGRESSION: %', failures;
  end if;
end $$;
rollback;

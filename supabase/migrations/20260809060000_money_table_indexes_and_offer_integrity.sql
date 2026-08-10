-- Money-table read paths and product-offer referential integrity.
--
-- Every money table currently carries exactly one index: its primary key.
-- The teacher sales list, the student purchase list, the earnings ledger, the
-- refund webhook and the subscriber list all filter on OTHER columns, so each
-- of them is a sequential scan (pg_stat_user_tables: orders seq_scan=462
-- idx_scan=0, payout_ledger seq_scan=152 idx_scan=0). The tables are empty
-- today, which is precisely why this is cheap now and expensive later.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: the tables have zero rows, so
-- the exclusive lock is held for microseconds, and CONCURRENTLY cannot run
-- inside the transaction a migration is wrapped in.

-- Teacher sales list: .eq("teacher_id").order("created_at").order("id").range()
create index if not exists orders_teacher_created_idx
  on public.orders (teacher_id, created_at, id);

-- Student purchase history: .eq("user_id") ordered newest first.
create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

-- Teacher earnings: .eq("teacher_id").order("created_at").order("id")
create index if not exists payout_ledger_teacher_created_idx
  on public.payout_ledger (teacher_id, created_at, id);

-- Refund webhook: finds the subscription earnings row by payment intent id.
-- Partial — the column is null for rows that never had a payment intent.
create index if not exists payout_ledger_payment_idx
  on public.payout_ledger (payment_id)
  where payment_id is not null;

-- Teacher subscriber list: .eq("teacher_id").order("created_at").order("id")
create index if not exists course_subscriptions_teacher_created_idx
  on public.course_subscriptions (teacher_id, created_at, id);

-- product_offers.course_id had no foreign key, while its own child
-- (product_prices.offer_id) and its sibling (course_coupons.course_id) both
-- cascade. Neither delete_course_as_admin nor delete_teacher_course_draft
-- touches offers, so deleting a course orphaned its offers and prices — and
-- because product_offers_public_code_uniq is a global unique on
-- lower(public_code), the dead course's public code stayed burned forever.
delete from public.product_offers o
 where not exists (select 1 from public.courses c where c.id = o.course_id);

alter table public.product_offers
  add constraint product_offers_course_id_fkey
  foreign key (course_id) references public.courses(id) on delete cascade;

-- amount_minor is numeric and only guarded by >= 0, but it is copied into
-- orders.amount_minor, which is int4. A teacher storing 1999.5 minor units
-- would either round silently into the order row or be rejected by Stripe,
-- leaving the stored order amount different from the amount actually charged.
-- The API only checks Number.isFinite, so the guard belongs here.
alter table public.product_prices
  add constraint product_prices_amount_minor_integral
  check (amount_minor = trunc(amount_minor));

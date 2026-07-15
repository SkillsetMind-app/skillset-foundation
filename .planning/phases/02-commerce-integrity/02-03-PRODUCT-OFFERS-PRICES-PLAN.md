# 02-03 — Product / offers / prices (without breaking legacy)

**Goal:** allow multi-price / offer packaging later without rewriting every course row.  
**Constraint:** today `TeacherCourse` has a **single** `priceAmountMinor` + `paymentType` — that must keep working.

## Current model (legacy, keep)

```
courses
  price_amount_minor
  currency
  payment_type  (one_time | subscription_monthly | subscription_yearly | free)
```

Checkout and webhooks already key off course id + payment type.

## Target model (additive)

```
product (1:1 with course for v1, or course.product_id later)
  offers[]  — commercial packages (e.g. "Mentoria completa", "Só comunidade")
    prices[] — Stripe-facing price points (one_time / recurring interval)
```

**v1 rule (ponytail):** do **not** migrate data.  
Introduce optional tables + dual-read:

1. If course has no offers → use legacy columns (current path).
2. If course has default offer/price → checkout prefers that.

## Minimal schema (after live dump / next migration)

```sql
-- sketch only; apply after baseline + live dump review
CREATE TABLE IF NOT EXISTS public.product_offers (
  id text PRIMARY KEY,
  course_id text NOT NULL,
  name text NOT NULL,
  is_default boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.product_prices (
  id text PRIMARY KEY,
  offer_id text NOT NULL,
  amount_minor numeric NOT NULL,
  currency text NOT NULL,
  payment_type text NOT NULL, -- reuse TeacherCoursePaymentType strings
  stripe_price_id text,
  active boolean DEFAULT true
);
```

## App touch points (order)

1. Domain types: `ProductOffer`, `ProductPrice` (+ tests).
2. Checkout: if `default_price` present, use it; else legacy.
3. Teacher create UI: still one price field; write **both** legacy columns and a default offer/price row when tables exist.
4. Subscription center MRR: sum from active subscriptions still via course price until multi-price needed.

## Non-goals this slice

- Full Hotmart multi-offer matrix
- Co-producer splits per offer
- Tax/affiliate per price

## Done when

- [ ] Domain + dual-read checkout documented
- [ ] Migration optional tables (or types updated after dump)
- [ ] Legacy one-price courses unchanged in tests

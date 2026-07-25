# Marketplace Payments Plan

Last updated: 2026-04-26

> ⚠️ **SUPERSEDED (2026-07-24) by the direct-charges pivot — see `docs/plans/2026-07-24-pivot-direct-charges.md`.**
> This document prescribes **destination charges**, where the payment is created on the
> SkillsetMind platform account and funds are transferred out to the teacher. That is no
> longer the model. The platform now uses **direct charges**: the buyer is charged on the
> **teacher's** connected account, the teacher is the **merchant of record**, and SkillsetMind
> takes its cut via `application_fee_amount` at charge time. The platform never holds a
> balance for the teacher and adds no clearing period of its own — Stripe's own settlement
> and payout timelines still apply and are unchanged by us. Refunds and lost disputes are
> debited from the teacher's Stripe balance (with `refund_application_fee: true`).
> The fee ladder below (8/4/1/0%) is also stale — the live ladder is Free 10% / Starter 5% /
> Pro 3% / Plus 2% (`src/data/plans.ts`). Kept for history only; do not implement from it.

## Product Flow

Public visitors browse the marketplace, filter courses, open a course detail page, and watch free preview lessons when the teacher chooses to expose them.

Paid content stays locked until the learner has an active enrollment. Enrollment must be created only after payment succeeds through a trusted backend/webhook, never only from a client redirect.

## Recommended Payment Provider

Stripe is still the best first choice for the US-first marketplace because it supports:

- hosted Checkout for a faster and safer first integration;
- Connect for marketplace payouts to teachers;
- application fees so Skillset can collect a platform take-rate;
- webhooks for reliable fulfillment after payment success.

Recommended first implementation:

Stripe Checkout + Stripe Connect destination charges.

Why:

- The customer pays through a Stripe-hosted checkout.
- The payment is created on the Skillset platform account.
- Stripe can transfer funds to the teacher connected account.
- Skillset can collect `application_fee_amount` as the platform fee.
- The webhook confirms payment before creating enrollment.

## Stripe Dashboard Setup

Start in test/sandbox mode.

1. Complete account profile, support email, statement descriptor, and public business details.
2. In payment method settings, keep Dashboard-managed payment methods. Do not hardcode card-only checkout.
3. In branding settings, upload the Skillset icon/logo and use the Skillset blue as the Checkout brand color.
4. Create webhook endpoints only after Firebase Functions or another backend endpoint exists.
5. Store `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the frontend environment and keep `STRIPE_SECRET_KEY` plus `STRIPE_WEBHOOK_SECRET` only in backend secrets.
6. Enable Connect when teacher payout onboarding is ready.

Detailed setup file: `docs/stripe-setup.md`.

## Fee Model

Default placeholder:

- Skillset platform fee comes from the creator plan: Free 8% (`800` bps), Starter 4%, Pro 1%, Plus 0%.
- Teacher gross share before Stripe/payment fees depends on that plan.
- Course pricing is stored in minor units, never floats.

Example:

- Course price: `$100.00`
- Skillset fee on Free at 8%: `$8.00`
- Teacher gross transfer before Stripe fee: `$92.00`

The exact fee is resolved server-side from the teacher plan at sale time.

## Required Data Model

Course:

- `priceAmountMinor`
- `currency`
- `platformFeeBps`
- `teacherId`
- `freePreviewLessonIds`
- `published`

Teacher payout profile:

- `teacherId`
- `stripeConnectedAccountId`
- `chargesEnabled`
- `payoutsEnabled`
- `onboardingStatus`

Order:

- `userId`
- `courseId`
- `teacherId`
- `amountMinor`
- `currency`
- `platformFeeAmountMinor`
- `stripeCheckoutSessionId`
- `stripePaymentIntentId`
- `status`

Enrollment:

- `userId`
- `courseId`
- `status`
- `orderId`
- `createdAt`

## Backend Sequence

1. Learner clicks purchase.
2. Client calls a trusted backend endpoint or Firebase Function.
3. Backend validates that the course is published and paid.
4. Backend computes Skillset platform fee from server-side data.
5. Backend creates a Stripe Checkout Session with Connect destination transfer and application fee.
6. Learner completes checkout on Stripe.
7. Stripe webhook receives payment completion.
8. Webhook verifies signature and payment status.
9. Webhook writes `Order`.
10. Webhook creates or activates `Enrollment`.
11. Student app grants access based on enrollment, not on client state.

## Access Rules

Public:

- Can read only published marketplace course metadata.
- Can read preview lessons marked public.

Enrolled student:

- Can read protected lessons for purchased courses.
- Can access course community if enrollment is active.

Teacher:

- Can manage their own courses.
- Can upload course materials according to course ownership.

Admin/Ops:

- Can review courses, resolve disputes, and inspect orders/enrollments.

## What Not To Build Yet

- Custom payment form.
- Manual payout ledger.
- Multi-provider payments.
- Subscriptions.
- Split payment across multiple teachers.
- Refund automation before orders/enrollments exist.

## References

- Stripe Connect destination charges: https://docs.stripe.com/connect/destination-charges
- Stripe Connect charge types: https://docs.stripe.com/connect/charges
- Stripe marketplace payment task: https://docs.stripe.com/connect/marketplace/tasks/accept-payment

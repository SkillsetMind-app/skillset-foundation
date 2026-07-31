# Stripe Setup for Skillset

Last updated: 2026-04-26

## Current Decision

Use Stripe Checkout first, then Stripe Connect for teacher payouts.

The first safe production shape is:

1. Student clicks purchase on Skillset.
2. A trusted backend creates a Stripe Checkout Session.
3. Student pays on Stripe-hosted Checkout.
4. Stripe sends a webhook to the backend.
5. Backend verifies the webhook signature.
6. Backend writes the order/payment records.
7. Backend creates or activates the enrollment.

The client must never create paid enrollments from a redirect alone.

## What To Configure In Stripe Now

Stay in test/sandbox mode first. Do not switch to production until the full webhook flow is working.

1. Account identity
   - Open Stripe Dashboard.
   - Complete business profile as much as possible.
   - Set the public business name exactly to `SkillsetMind`.
   - Use `Skillset USA` only as the legal entity name in tax, contract, and
     billing fields that explicitly request it.
   - Add support email.
   - Add a statement descriptor that buyers can recognize as `SkillsetMind`.

2. Payment methods
   - Go to Payments settings.
   - Keep cards enabled.
   - Enable Apple Pay / Google Pay if available for the account.
   - Let Checkout use Dashboard-managed payment methods. Do not hardcode card-only methods in code.

3. Branding
   - Add logo/icon.
   - Use Skillset blue as the primary brand color.
   - Keep Checkout visually consistent with the site.

4. Checkout settings
   - Keep Stripe-hosted Checkout for v0.
   - Do not use Payment Links for the platform flow because Skillset needs to create enrollments only after webhook success.
   - Do not create one Payment Link per course as the main system. That blocks reliable course/access automation.

5. Webhooks
   - Test endpoint is configured for the deployed Firebase Function.
   - Current test endpoint URL: `https://stripewebhook-7foyhb2owa-uc.a.run.app`
   - Required events for v0:
     - `checkout.session.completed`
     - `checkout.session.expired`
     - `payment_intent.payment_failed`
     - `charge.refunded`
   - Save the webhook signing secret as `STRIPE_WEBHOOK_SECRET` in backend secrets only.

6. API keys
   - Copy the publishable key to `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
   - Copy the secret key only into Firebase Functions secret config.
   - Never put `STRIPE_SECRET_KEY` into any frontend file or `NEXT_PUBLIC_*` variable.

7. Connect for teachers
   - Enable Connect when ready to onboard teachers for payouts.
   - Use connected accounts for teachers.
   - Skillset uses **direct charges**: create the Checkout Session on the teacher's connected account (`{ stripeAccount }`) and collect the platform fee with `application_fee_amount`. The teacher is the merchant of record; Skillset never transfers the teacher's share out of a platform balance and never holds it.
   - The teacher needs a connected account before paid course publication should be enabled.

## What Requires Firebase Next

Stripe Checkout cannot be implemented safely in a static-only frontend. The project needs Firebase Functions or another trusted backend.

Recommended Firebase Functions:

- `createCheckoutSession`
- `stripeWebhook`
- `createTeacherStripeAccount`
- `createTeacherOnboardingLink`

Firebase Functions are now deployed for the test environment. Blaze/pay-as-you-go may still produce usage-based costs as traffic grows.

## Environment Values

Frontend:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Backend / Firebase Functions secrets:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...
```

Set backend secrets through Firebase CLI, not source files:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY --project skillsetusaofficial
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project skillsetusaofficial
```

Only enable the frontend checkout flag after both Functions and the Stripe webhook are working:

```env
NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED=true
```

## Deployment Order

1. `STRIPE_SECRET_KEY` is set in Firebase Secret Manager.
2. `createCheckoutSession` and `stripeWebhook` are deployed.
3. Stripe test webhook is created and points to the deployed endpoint.
4. `STRIPE_WEBHOOK_SECRET` is set in Firebase Secret Manager.
5. `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED=true` is enabled locally.
6. Hosting must be rebuilt and redeployed after checkout UI changes.

## Go-Live Guardrails

- Test the full purchase flow in sandbox first.
- Verify duplicate webhooks do not create duplicate enrollments.
- Do not grant access from `success_url`.
- Verify refunds update order/payment/enrollment state.
- Recreate required Stripe objects in live mode; sandbox objects do not carry into live mode.
- Use live webhook endpoints separately from test webhook endpoints.
- Rotate any keys that were copied into unsafe places during setup.

## References

- Stripe Checkout Sessions: https://docs.stripe.com/api/checkout/sessions
- Stripe dashboard-managed payment methods: https://docs.stripe.com/payments/dashboard-payment-methods
- Stripe webhook configuration: https://docs.stripe.com/webhooks/configure
- Stripe Connect direct charges: https://docs.stripe.com/connect/direct-charges
- Stripe go-live checklist: https://docs.stripe.com/get-started/checklist/go-live
